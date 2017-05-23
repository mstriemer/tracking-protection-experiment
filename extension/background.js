browser.webRequest.onBeforeRequest.addListener(
  (request) => {
    console.log(request.url);
    return { cancel: false };
  },
  { urls: ["*://*/*"] },
  ['blocking']);

(async function() {
  console.log(`experiment: ${await browser.classifiedWebRequest.classifyUrls()}`);
})();

browser.classifiedWebRequest.onBeforeRequest.addListener(
  (request) => {
    console.log(request.url);
    return { cancel: false };
  },
  { urls: ["*://*/*"], classifiedAs: ["example"] },
  ['blocking']);
