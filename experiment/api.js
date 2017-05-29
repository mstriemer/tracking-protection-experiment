/* global ExtensionAPI, Services, Components, MatchPattern, WebRequest */
const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/MatchPattern.jsm");
Cu.import("resource://gre/modules/WebRequest.jsm");

const ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);

function SingletonEventManager(context, name, register) {
  this.context = context;
  this.name = name;
  this.register = register;
  this.unregister = new Map();
}

SingletonEventManager.prototype = {
  addListener(callback, ...args) {
    if (this.unregister.has(callback)) {
      return;
    }

    let shouldFire = () => {
      if (this.context.unloaded) {
        // dump(`${this.name} event fired after context unloaded.\n`);
      } else if (!this.context.active) {
        // dump(`${this.name} event fired while context is inactive.\n`);
      } else if (this.unregister.has(callback)) {
        return true;
      }
      return false;
    };

    let fire = {
      sync: (...args) => {
        if (shouldFire()) {
          return this.context.runSafe(callback, ...args);
        }
      },
      async: (...args) => {
        return Promise.resolve().then(() => {
          if (shouldFire()) {
            return this.context.runSafe(callback, ...args);
          }
        });
      },
      raw: (...args) => {
        if (!shouldFire()) {
          throw new Error("Called raw() on unloaded/inactive context");
        }
        return callback(...args);
      },
      asyncWithoutClone: (...args) => {
        return Promise.resolve().then(() => {
          if (shouldFire()) {
            return this.context.runSafeWithoutClone(callback, ...args);
          }
        });
      },
    };


    let unregister = this.register(fire, ...args);
    this.unregister.set(callback, unregister);
    this.context.callOnClose(this);
  },

  removeListener(callback) {
    if (!this.unregister.has(callback)) {
      return;
    }

    let unregister = this.unregister.get(callback);
    this.unregister.delete(callback);
    try {
      unregister();
    } catch (e) {
      Cu.reportError(e);
    }
    if (this.unregister.size == 0) {
      this.context.forgetOnClose(this);
    }
  },

  hasListener(callback) {
    return this.unregister.has(callback);
  },

  revoke() {
    for (let callback of this.unregister.keys()) {
      this.removeListener(callback);
    }
  },

  close() {
    this.revoke();
  },

  api() {
    return {
      addListener: (...args) => this.addListener(...args),
      removeListener: (...args) => this.removeListener(...args),
      hasListener: (...args) => this.hasListener(...args),
    };
  },
};

/*
 * Generate all domain combinations for a URL.
 *
 * https://sub.example.co.uk/foo becomes:
 *   ["uk", "co.uk", "example.co.uk", "sub.example.co.uk"]
 */
function allHostsForUrl(url) {
  const uri = ioService.newURI(url);
  return uri.host.split('.').reduceRight((hosts, part) => {
    if (hosts.length === 0) {
      return [part];
    }
    return [...hosts, `${part}.${hosts[hosts.length - 1]}`];
  }, []);
}

// eslint-disable-next-line no-unused-vars
class API extends ExtensionAPI {
  getAPI(context) {
    const eventName = "onBeforeRequest";
    // urlsForClassification is a mapping of classification names to a Set of
    // URL fragments that match the classification.
    const urlsForClassification = {};

    function isUrlClassifiedAs(url, name) {
      const urls = urlsForClassification[name];
      if (!urls) {
        return false;
      }
      return allHostsForUrl(url).some((host) => urls.has(host));
    }

    return {
      classifiedWebRequest: {

        classifyUrls(name, urls) {
          urlsForClassification[name] = new Set(urls);
        },


        onBeforeRequest: new SingletonEventManager(
          context,
           "classifiedWebRequest.onBeforeRequest",
          (fire, filterAll, info) => {
            const { classifiedAs, urls, ...filter } = filterAll;
            if (urls) {
              filter.urls = urls;
            } else {
              filter.urls = ["*://*/*"];
            }

            let listener = data => {
              // If this URL isn't in the classified set then return.
              if (!isUrlClassifiedAs(data.url, classifiedAs)) {
                return;
              }

              // Prevent listening in on requests originating from system principal to
              // prevent tinkering with OCSP, app and addon updates, etc.
              if (data.isSystemPrincipal) {
                return;
              }

              // Check hosts permissions for both the resource being requested,
              const hosts = context.extension.whiteListedHosts;
              if (!hosts.matchesIgnoringPath(Services.io.newURI(data.url))) {
                return;
              }
              // and the origin that is loading the resource.
              const origin = data.documentUrl;
              const own = origin && origin.startsWith(context.extension.getURL());
              if (origin && !own && !hosts.matchesIgnoringPath(Services.io.newURI(origin))) {
                return;
              }

              let browserData = {tabId: -1, windowId: -1};
              // Tab and window filtering isn't supported.
              // if (data.browser) {
              //   browserData = tabTracker.getBrowserData(data.browser);
              // }
              if (filter.tabId != null && browserData.tabId != filter.tabId) {
                return;
              }
              if (filter.windowId != null && browserData.windowId != filter.windowId) {
                return;
              }

              let data2 = {
                requestId: data.requestId,
                url: data.url,
                originUrl: data.originUrl,
                documentUrl: data.documentUrl,
                method: data.method,
                tabId: browserData.tabId,
                type: data.type,
                timeStamp: Date.now(),
                frameId: data.type == "main_frame" ? 0 : data.windowId,
                parentFrameId: data.type == "main_frame" ? -1 : data.parentWindowId,
              };

              const maybeCached = ["onResponseStarted", "onBeforeRedirect", "onCompleted", "onErrorOccurred"];
              if (maybeCached.includes(eventName)) {
                data2.fromCache = !!data.fromCache;
              }

              if ("ip" in data) {
                data2.ip = data.ip;
              }

              let optional = [
                "requestHeaders", "responseHeaders", "statusCode", "statusLine", "error", "redirectUrl",
                "requestBody", "scheme", "realm", "isProxy", "challenger",
              ];
              for (let opt of optional) {
                if (opt in data) {
                  data2[opt] = data[opt];
                }
              }

              return fire.sync(data2);
            };

            let filter2 = {};
            if (filter.urls) {
              filter2.urls = new MatchPattern(filter.urls);
              if (!filter2.urls.overlapsPermissions(context.extension.whiteListedHosts, context.extension.optionalOrigins)) {
                Cu.reportError("The webRequest.addListener filter doesn't overlap with host permissions.");
              }
            }
            if (filter.types) {
              filter2.types = filter.types;
            }
            if (filter.tabId) {
              filter2.tabId = filter.tabId;
            }
            if (filter.windowId) {
              filter2.windowId = filter.windowId;
            }

            let info2 = [];
            if (info) {
              for (let desc of info) {
                if (desc == "blocking" && !context.extension.hasPermission("webRequestBlocking")) {
                  Cu.reportError("Using webRequest.addListener with the blocking option " +
                                "requires the 'webRequestBlocking' permission.");
                } else {
                  info2.push(desc);
                }
              }
            }

            WebRequest[eventName].addListener(listener, filter2, info2);
            return () => {
              WebRequest[eventName].removeListener(listener);
            };
          }).api(),
      }
    };
  }
}
