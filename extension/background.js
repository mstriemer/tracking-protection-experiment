async function getTrackerDomains() {
  const servicesUrl = browser.extension.getURL("services.json");
  const { categories } = await (await fetch(servicesUrl)).json();
  const domains = [];
  const ignoredCategory = (category) => category === "Content";

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

async function setupClassifyUrls(domains) {
  console.log("Classify domains as trackers", domains);
  browser.classifiedWebRequest.classifyRequests("tracker", {
    domains,
    thirdParty: true,
  });
}

async function init() {
  const domains = await getTrackerDomains();

  await setupClassifyUrls(domains);
  browser.classifiedWebRequest.onBeforeRequest.addListener(
    (request) => {
      console.log(request.url, request.originUrl);
      return { cancel: true };
    },
    { classifiedAs: "tracker" },
    ["blocking"]);
}

init();
