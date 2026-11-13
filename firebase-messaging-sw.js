importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyCD2_omUv2O9H3B0YEhlQ1KJbKzdBxrIx0",
  authDomain: "wandsmp-98824.firebaseapp.com",
  databaseURL: "https://wandsmp-98824-default-rtdb.firebaseio.com",
  projectId: "wandsmp-98824",
  messagingSenderId: "375935441371",
  appId: "1:375935441371:web:38ad3f4501f91d452a6ffe"
});
const messaging = firebase.messaging();
// يوصل الإشعار حتى لو الموقع مقفول
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  return self.registration.showNotification("📞 " + (d.name || "أحد") + " يتصل فيك", {
    body: "اضغط عشان تفتح الشات وترد",
    tag: "wand-call",
    renotify: true,
    requireInteraction: true,
    vibrate: [500, 250, 500, 250, 500, 250, 500]
  });
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = self.registration.scope + "chat.html";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(url) && "focus" in c) return c.focus();
    return clients.openWindow(url);
  }));
});

// مطلوب عشان المتصفح يسمح بتثبيت الموقع كتطبيق
self.addEventListener("fetch", () => {});
