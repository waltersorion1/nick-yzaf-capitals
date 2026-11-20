const $ = (selector) => document.querySelector(selector);
const message = (text) => {
  $("#message").textContent = text;
};
async function api(path, body) {
  const headers = {};
  if (body !== undefined) {
    const csrf = await fetch("/api/auth/csrf", { cache: "no-store" });
    if (!csrf.ok) throw new Error("Unable to start secure request");
    headers["X-CSRF-Token"] = (await csrf.json()).token;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Request failed");
  }
  return response.status === 204 ? null : response.json();
}
function signedIn(user) {
  $("#login").hidden = !!user;
  $("#account").hidden = !user;
  $("#identity").textContent = user ? `${user.email} · ${user.role}` : "";
}
$("#login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    signedIn(
      await api(
        "/api/auth/login",
        Object.fromEntries(new FormData(event.target)),
      ),
    );
    event.target.reset();
    message("Signed in securely.");
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
});
$("#invite").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api(
      "/api/auth/accept-invite",
      Object.fromEntries(new FormData(event.target)),
    );
    event.target.reset();
    message("Account activated. Sign in above.");
  } catch (error) {
    message(error.message);
  }
});
$("#logout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", {});
    signedIn(null);
    message("Signed out.");
  } catch (error) {
    message(error.message);
  }
});
function connection() {
  $("#connection").textContent = navigator.onLine
    ? "Online"
    : "Offline · private data requires a connection";
  if (!navigator.onLine) signedIn(null);
}
addEventListener("online", connection);
addEventListener("offline", connection);
connection();
addEventListener("pagehide", () => {
  signedIn(null);
  $("#login").reset();
  $("#invite").reset();
  message("");
});
addEventListener("pageshow", () =>
  api("/api/auth/me")
    .then(signedIn)
    .catch(() => signedIn(null)),
);
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      function offer() {
        if (registration.waiting) $("#update").hidden = false;
      }
      offer();
      registration.addEventListener("updatefound", () => {
        registration.installing?.addEventListener("statechange", offer);
      });
      $("#update").onclick = () =>
        registration.waiting?.postMessage("ACTIVATE");
    })
    .catch(() => message("Offline shell is unavailable."));
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      location.reload();
    }
  });
}
