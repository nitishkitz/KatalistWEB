/* Firebase Cloud Messaging service worker — handles background push. */
/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBYdtG1ezZ4XEjGhhdaFVsYF7jHmMQOUeU",
  authDomain: "katalist-d2f9e.firebaseapp.com",
  projectId: "katalist-d2f9e",
  storageBucket: "katalist-d2f9e.firebasestorage.app",
  messagingSenderId: "485296168291",
  appId: "1:485296168291:web:9d8e2b1d50e55841974756",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || "Katalist";
  const body = (payload.notification && payload.notification.body) || (payload.data && payload.data.body) || "";
  self.registration.showNotification(title, {
    body,
    icon: "/katalist-mark-app.png",
    badge: "/katalist-mark-app.png",
    data: payload.data || {},
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
