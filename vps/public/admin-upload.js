document.addEventListener("DOMContentLoaded", () => {
  const savedPosition = Number(window.sessionStorage.getItem("release-save-position") || 0);
  const recentlySaved = savedPosition > 0 && Date.now() - savedPosition < 30000;
  const editedReleaseId = new URLSearchParams(window.location.search).get("edit");
  const hashReleaseId = window.location.hash.match(/^#release-actions-(\d+)$/)?.[1];
  const actionReleaseId = hashReleaseId || (recentlySaved ? editedReleaseId : "");

  if (actionReleaseId) {
    const actions = document.getElementById(`release-actions-${actionReleaseId}`);
    const restorePosition = () => actions?.scrollIntoView({ block: "end", behavior: "auto" });
    window.requestAnimationFrame(() => window.requestAnimationFrame(restorePosition));
    window.addEventListener("load", restorePosition, { once: true });
    window.setTimeout(() => {
      restorePosition();
      window.sessionStorage.removeItem("release-save-position");
    }, 150);
  }

  document.querySelectorAll('form[enctype="multipart/form-data"]').forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (event.submitter?.formAction.endsWith("/admin/releases/preview")) return;
      const keepActionsVisible = event.submitter?.name === "publish_action" && event.submitter.value === "save";
      const releaseId = form.querySelector('input[name="id"]')?.value || "";
      const saveExistingRelease = keepActionsVisible && Boolean(releaseId);
      if (keepActionsVisible && !saveExistingRelease) {
        window.sessionStorage.setItem("release-save-position", String(Date.now()));
      }

      const hasFile = Array.from(form.querySelectorAll('input[type="file"]'))
        .some((input) => input.files && input.files.length > 0);
      if (!hasFile && !saveExistingRelease) return;

      event.preventDefault();
      const button = event.submitter || form.querySelector('button[type="submit"]');
      const actionArea = form.querySelector(".release-actions");
      const progressBox = document.createElement("div");
      progressBox.setAttribute("role", "status");
      progressBox.setAttribute("aria-live", "polite");
      if (hasFile) {
        progressBox.className = "upload-progress is-in-actions";
        progressBox.innerHTML = '<div class="upload-progress-label"><span>Ανέβασμα αρχείου…</span><b>0%</b></div><progress max="100" value="0">0%</progress>';
        actionArea?.prepend(progressBox);
      } else {
        progressBox.className = "save-feedback";
        progressBox.textContent = "Αποθήκευση…";
        actionArea?.prepend(progressBox);
      }

      if (!progressBox.isConnected) form.appendChild(progressBox);

      if (button) button.disabled = true;
      const label = progressBox.querySelector("span") || progressBox;
      const percentage = progressBox.querySelector("b");
      const progress = progressBox.querySelector("progress");
      const update = (value) => {
        const safeValue = Math.min(100, Math.max(0, Math.round(value)));
        if (percentage) percentage.textContent = `${safeValue}%`;
        if (progress) {
          progress.value = safeValue;
          progress.textContent = `${safeValue}%`;
        }
      };

      const request = new XMLHttpRequest();
      request.open((form.method || "POST").toUpperCase(), form.action);
      request.upload.addEventListener("progress", (uploadEvent) => {
        if (uploadEvent.lengthComputable) update((uploadEvent.loaded / uploadEvent.total) * 100);
      });
      request.addEventListener("load", () => {
        if (request.status >= 200 && request.status < 400) {
          update(100);
          if (saveExistingRelease) {
            label.textContent = "Η ανάρτηση αποθηκεύτηκε.";
            progressBox.classList.add("is-success");
            form.querySelectorAll('input[type="file"]').forEach((input) => { input.value = ""; });
            document.querySelector(".success")?.remove();
            window.sessionStorage.removeItem("release-save-position");
            if (button) button.disabled = false;
            window.setTimeout(() => progressBox.remove(), 4000);
            return;
          }
          label.textContent = "Το ανέβασμα ολοκληρώθηκε.";
          const destination = new URL(request.responseURL || "/admin", window.location.origin);
          const savedReleaseId = destination.searchParams.get("edit");
          if (keepActionsVisible && savedReleaseId) destination.hash = `release-actions-${savedReleaseId}`;
          window.location.href = destination.href;
          return;
        }
        window.sessionStorage.removeItem("release-save-position");
        label.textContent = "Το ανέβασμα απέτυχε. Δοκίμασε ξανά.";
        if (button) button.disabled = false;
      });
      request.addEventListener("error", () => {
        window.sessionStorage.removeItem("release-save-position");
        label.textContent = "Η σύνδεση διακόπηκε. Δοκίμασε ξανά.";
        if (button) button.disabled = false;
      });
      const formData = new FormData(form);
      if (event.submitter?.name && !formData.has(event.submitter.name)) {
        formData.append(event.submitter.name, event.submitter.value);
      }
      request.send(formData);
    });
  });

  document.querySelectorAll(".release-delete-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const formId = button.dataset.deleteForm;
      const deleteForm = formId ? document.getElementById(formId) : null;
      if (!deleteForm || !window.confirm("Να διαγραφεί η ανάρτηση;")) return;
      deleteForm.requestSubmit();
    });
  });
});
