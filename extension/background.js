async function getTrackerDomains() {
  const servicesUrl = browser.extension.getURL("services.json");
  const { categories } = await (await fetch(servicesUrl)).json();
  const domains = [];
  const ignoredCategory = (category) => categorie === "Content";

  Object.keys(categories).forEach((category) => {
    if (ignoredCategory(category)) {
      return;
    }
    categories[category].forEach((provider) => {
      Object.keys(provider).forEach((providerName) => {
        Object.keys(provider[providerName]).forEach((providerUrl) => {
          provider[providerName][providerUrl].forEach((domain) => {
            domains.push(domain);
          });
        });
      });
    });
  });

  return domains;
}

async function getPublicSuffixes() {
  const fileURL = browser.extension.getURL("public_suffix_list.dat");
  const lines = (await (await fetch(fileURL)).text()).split("\n");
  const domains = lines.filter((line) => {
    return line.length > 0 && !line.startsWith("//");
  });
  console.log("public suffixes", domains);
  return new Set(domains);
}

async function setupClassifyUrls(domains) {
  console.log("Classify domains as trackers", domains);
  browser.classifiedWebRequest.classifyUrls("tracker", domains);
}

async function init() {
  const domains = await getTrackerDomains();
  const publicSuffixes = await getPublicSuffixes();

  function allHostsForUrl(url) {
    const uri = new URL(url);
    return uri.host.split('.').reduceRight((hosts, part) => {
      if (hosts.length === 0) {
        return [part];
      }
      return [...hosts, `${part}.${hosts[hosts.length - 1]}`];
    }, []).filter((host) => !publicSuffixes.has(host));
  }

  function isThirdPartyRequest(topHost, requestHost) {
    const topHosts = new Set(allHostsForUrl(topHost));
    return !allHostsForUrl(requestHost).some((host) => topHosts.has(host));
  }

  function handleRequest(request) {
    const isThirdParty = isThirdPartyRequest(request.originUrl, request.url);
    console.log(request.url, request.originUrl, isThirdParty);
    return { cancel: isThirdParty };
  }

  function isBlockedRequest(blocklist, request) {
    return allHostsForUrl(request.url).some((host) => blocklist.has(host));
  }

  if (browser.classifiedWebRequest) {
    await setupClassifyUrls(domains);
    console.log("Using classifiedWebRequest");
    browser.classifiedWebRequest.onBeforeRequest.addListener(
      handleRequest,
      { classifiedAs: ["tracker"] },
      ["blocking"]);
  } else {
    const blocklist = new Set(domains);
    console.log("Using webRequest");
    browser.webRequest.onBeforeRequest.addListener(
      (request) => {
        console.log('got', request);
        if (isBlockedRequest(blocklist, request)) {
          return handleRequest(request);
        }
        return { cancel: false };
      },
      { urls: ["*://*/*"] },
      ["blocking"]);
  }
}

init();
