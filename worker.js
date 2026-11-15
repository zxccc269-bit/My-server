// WandSMP — Cloudflare Worker: يرسل إشعار اتصال (FCM) حتى لو الموقع مقفول
// Secret مطلوب: SERVICE_ACCOUNT  (محتوى ملف Service Account JSON كامل)
// Variable اختياري: ALLOWED_ORIGIN  (مثال: https://username.github.io)

const PROJECT_ID = "wandsmp-98824";
const DB_URL = "https://wandsmp-98824-default-rtdb.firebaseio.com";
const WEB_API_KEY = "AIzaSyCD2_omUv2O9H3B0YEhlQ1KJbKzdBxrIx0"; // مفتاح الويب العام (موجود أصلاً في الموقع)

const b64url = (buf) => {
  let s = ""; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = enc({ alg: "RS256", typ: "JWT" });
  const claim = enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  });
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim));
  const jwt = head + "." + claim + "." + b64url(sig);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token");
  return j.access_token;
}

async function verifyUser(idToken) {
  const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + WEB_API_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.users && j.users[0] ? j.users[0].localId : null;
}

export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const reply = (obj, status = 200) =>
      new Response(JSON.stringify({ v: 3, ...obj }), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return reply({ ok: false }, 405);

    try {
      const { to, idToken } = await req.json();
      if (!to || !idToken) return reply({ ok: false, e: "bad" }, 400);

      // 1) تأكد من هوية المتصل
      const from = await verifyUser(idToken);
      if (!from) return reply({ ok: false, e: "auth" }, 401);

      const sa = JSON.parse(env.SERVICE_ACCOUNT);
      const at = await getAccessToken(sa);

      // 2) تأكد إن الاتصال موجود فعلاً وحديث (يمنع إرسال إشعارات عشوائية)
      const callRes = await fetch(`${DB_URL}/calls/${encodeURIComponent(to)}/${encodeURIComponent(from)}.json?access_token=${at}`);
      const call = await callRes.json();
      if (!call || typeof call.time !== "number" || Math.abs(Date.now() - call.time) > 60000)
        return reply({ ok: false, e: "nocall" }, 403);

      // 3) توكنات المستلم
      const tkRes = await fetch(`${DB_URL}/fcmTokens/${encodeURIComponent(to)}.json?access_token=${at}`);
      const tokens = Object.keys((await tkRes.json()) || {});
      if (!tokens.length) return reply({ ok: true, sent: 0 });

      // 4) أرسل
      let sent = 0;
      const fails = [];
      await Promise.all(tokens.map(async (t) => {
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
          method: "POST",
          headers: { Authorization: "Bearer " + at, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              token: t,
              data: { name: String(call.name || "أحد").slice(0, 40), caller: from },
              android: { priority: "high", ttl: "30s" },
              webpush: { headers: { Urgency: "high", TTL: "30" } },
            },
          }),
        });
        if (r.ok) { sent++; return; }
        let body = {};
        try { body = await r.json(); } catch (e) {}
        const status = (body.error && body.error.status) || r.status;
        const msg = (body.error && body.error.message) || "";
        fails.push({ status, msg: msg.slice(0, 120) });
        // نحذف التوكن فقط لو FCM يقول إنه ميت فعلاً (مو لأي خطأ ثاني)
        const dead = status === "NOT_FOUND" || status === "UNREGISTERED" || /registration token/i.test(msg);
        if (dead) {
          await fetch(`${DB_URL}/fcmTokens/${encodeURIComponent(to)}/${encodeURIComponent(t)}.json?access_token=${at}`, { method: "DELETE" });
        }
      }));
      if (fails.length) return reply({ ok: true, sent, tokens: tokens.length, fails });
      return reply({ ok: true, sent });
    } catch (e) {
      return reply({ ok: false, e: "server" }, 500);
    }
  },
};