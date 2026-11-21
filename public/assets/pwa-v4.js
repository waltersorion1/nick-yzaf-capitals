export function setupPwa() {
  let prompt = null,
    registration = null,
    accepted = false;
  const install = document.querySelector("#install"),
    update = document.querySelector("#update");
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event;
    install.hidden = false;
  });
  install.onclick = async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    prompt = null;
    install.hidden = true;
  };
  addEventListener("appinstalled", () => {
    prompt = null;
    install.hidden = true;
  });
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .then((reg) => {
      registration = reg;
      function offer() {
        document.querySelector("#update-notice").hidden = !(
          reg.waiting && navigator.serviceWorker.controller
        );
      }
      offer();
      reg.addEventListener("updatefound", () =>
        reg.installing?.addEventListener("statechange", offer),
      );
      addEventListener("focus", () => reg.update().catch(() => {}));
    })
    .catch(() => {
      document.querySelector("#announcement").textContent =
        "Offline support could not be initialized.";
    });
  update.onclick = () => {
    if (!registration?.waiting) return;
    accepted = true;
    document.querySelectorAll("form").forEach((form) => form.reset());
    registration.waiting.postMessage("ACTIVATE");
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (accepted) location.reload();
  });
}
