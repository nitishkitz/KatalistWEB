/* Katalist web/PWA background notifications. Pinned Firebase compat 12.18.0. */
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js");

var ALLOWED_CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
var UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
var THING_PATH = new RegExp("^/\\?thing=" + UUID + "$");
var LIST_PATH = new RegExp("^/lists/" + UUID + "$");

function readConfig() {
  var params = new URL(self.location.href).searchParams;
  var config = {};
  for (var i = 0; i < ALLOWED_CONFIG_KEYS.length; i++) {
    var key = ALLOWED_CONFIG_KEYS[i];
    var value = params.get(key);
    if (value) config[key] = value;
  }
  return config;
}

function trustedPath(path) {
  if (typeof path !== "string") return "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.indexOf("://") !== -1 || path.indexOf("\\") !== -1) {
    return "/";
  }
  if (path === "/" || THING_PATH.test(path) || LIST_PATH.test(path)) return path;
  return "/";
}

firebase.initializeApp(readConfig());

firebase.messaging().onBackgroundMessage(function (payload) {
  var data = (payload && payload.data) || {};
  var path = trustedPath(data.path);
  var title = data.title || "Katalist";
  var body = data.body || "";
  return self.registration.showNotification(title, {
    body: body,
    data: { path: path },
  });
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var path = trustedPath(event.notification.data && event.notification.data.path);
  var targetUrl = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(self.location.origin) === 0 && "focus" in client) {
          return client.focus().then(function (focused) {
            if (focused && focused.navigate) return focused.navigate(targetUrl);
            return focused;
          });
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
