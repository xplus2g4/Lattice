(() => {
  const dialog = document.querySelector("#info-dialog");
  const title = document.querySelector("#dialog-title");
  const description = document.querySelector("#dialog-description");
  const signIn = document.querySelector("#signin-options");
  const story = document.querySelector("#story-options");
  const siteUrl = document.querySelector('link[rel="canonical"]').href;
  const notices = {
    waitlist: [
      "Good things are taking shape.",
      "Lattice is in development. The waitlist is not open yet, and no registration has been recorded. This page introduces the experience we’re working towards for NUS students.",
    ],
    campus: [
      "A course-wide connection.",
      "Campus is a proposed plan for coordinator-onboarded courses, including sponsored Plus access, aggregate learning insights, and standard onboarding support. Contact enquiries are not open yet. No request has been sent.",
    ],
    signin: [
      "A preview of signing in.",
      "Explore the planned sign-in options below. Authentication is not available on this marketing page.",
    ],
    instagram: [
      "An idea worth sharing.",
      "Download the Lattice Story image to share it yourself. Nothing is posted to Instagram from this page.",
    ],
  };
  document.querySelectorAll("[data-notice]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.notice;
      [title.textContent, description.textContent] = notices[kind];
      signIn.hidden = kind !== "signin";
      story.hidden = kind !== "instagram";
      document.querySelector("#provider-status").textContent = "";
      document.querySelector("#story-status").textContent = "";
      dialog.showModal();
    });
  });
  document
    .querySelectorAll(".close-dialog, .dialog-done")
    .forEach((button) =>
      button.addEventListener("click", () => dialog.close()),
    );
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog.close();
  });
  document.querySelectorAll("[data-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("#provider-status").textContent =
        `${button.dataset.provider} sign-in is a demo only. You have not been signed in, and no account information has been collected.`;
    });
  });
  async function copyAddress(status) {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(siteUrl);
      status.textContent = "Website address copied.";
    } catch {
      status.textContent = `Copy this address: ${siteUrl}`;
      const input = document.querySelector("#story-url");
      if (dialog.open && !story.hidden) {
        input.focus();
        input.select();
      }
    }
  }
  document
    .querySelector("#copy-link")
    .addEventListener("click", () =>
      copyAddress(document.querySelector("#share-status")),
    );
  document
    .querySelector("#story-copy")
    .addEventListener("click", () =>
      copyAddress(document.querySelector("#story-status")),
    );
  const concepts = {
    vectors: [
      "Start with vectors & spaces",
      "Build an intuition for direction, magnitude, and span. These ideas support matrices and linear transformations.",
    ],
    matrices: [
      "A new way to see a matrix",
      "Connect matrix operations to the vectors they act on. This foundation leads into linear transformations.",
    ],
    transforms: [
      "From matrices to transformations",
      "Revisit how a matrix moves a vector. Then try an optional quiz to check your understanding.",
    ],
    eigenvectors: [
      "Find what stays in the same direction",
      "Revisit linear transformations before exploring eigenvectors. An optional quiz would help update your mastery state.",
    ],
    applications: [
      "Bring the connections together",
      "Use vectors, matrices, and transformations to approach a new problem. Build on the ideas you have already explored.",
    ],
  };
  document.querySelectorAll("[data-concept]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-concept]").forEach((node) => {
        node.classList.toggle("is-selected", node === button);
        node.setAttribute("aria-pressed", String(node === button));
      });
      const [heading, copy] = concepts[button.dataset.concept];
      document.querySelector("#concept-title").textContent = heading;
      document.querySelector("#concept-description").textContent = copy;
    });
  });
})();
