# WebExtension API for improved tracking protection

The goal of this API is to improve the performance and ease of writing a
tracking protection extension. This is accomplished by updating `webRequest`
to support classifying requests which can be used to reduce the number of calls
made to `webRequest` event handlers.

This experiment only implements support for the `onBeforeRequest` event.

## API

### `webRequest.classifyRequests(name, options)`

This function will setup request classification which can be hooked into in
event handlers.

* name: A name for this class of request.
* options: The options to filter requests on.
  * domains: An array of domains that match this class.
    * defaults to all domains.
  * thirdParty: A boolean representing if this should only match third-party requests.
    * defaults to false.

```js
webRequest.classifyRequests(
    "tracker",
    { domains: ["example.com", "example.org"], thirdParty: true })
```

### Event handler updates

The filters for events are updated to support the `classifiedAs` filter. The
callback will only be triggered when a request matches the class as defined
by a call to `webRequest.classifyRequests`.

```js
webRequest.onBeforeRequest.addListener(
    handleRequest,
    { classifiedAs: "tracker" },
    ["blocking"])
```

## Structure

There are three components to this repository:

  * `experiment/` is the experiment code to implement the proposed API,
  * `extension/` is a test extension that uses the proposed API, and
  * `webRequest-extension/` is a test extension that does not use the proposed API.

## Comments

If you have any comments please [file an issue](https://github.com/mstriemer/tracking-protection-experiment/issues/new).
