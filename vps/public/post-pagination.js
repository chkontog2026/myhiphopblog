document.addEventListener("DOMContentLoaded", () => {
  const releases = document.querySelector("#releases");
  const posts = Array.from(document.querySelectorAll("#releases .post"));
  const filters = Array.from(document.querySelectorAll("[data-artist-filter]"));
  const searchInput = document.querySelector("#post-search-input");
  const clearSearch = document.querySelector("[data-search-clear]");
  const searchCount = document.querySelector("[data-search-count]");
  const sidebar = document.querySelector(".sidebar");
  const pageSize = 5;
  let activeArtist = "";
  let searchTerms = [];
  let visibleCount = pageSize;

  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("el-GR");

  posts.forEach((post) => { post.searchText = normalize(post.textContent); });

  const controls = document.createElement("div");
  controls.className = "more-posts";
  const moreButton = document.createElement("button");
  moreButton.type = "button";
  moreButton.textContent = "Περισσότερα";
  moreButton.setAttribute("aria-controls", "releases");
  controls.appendChild(moreButton);
  releases?.appendChild(controls);

  const syncSidebarHeight = () => {
    if (!releases || !sidebar) return;
    sidebar.style.setProperty("--posts-height", `${Math.ceil(releases.getBoundingClientRect().height)}px`);
  };

  const render = () => {
    const matching = posts.filter((post) => {
      const matchesArtist = !activeArtist || post.dataset.artist === activeArtist;
      const matchesSearch = searchTerms.every((term) => post.searchText.includes(term));
      return matchesArtist && matchesSearch;
    });
    posts.forEach((post) => { post.hidden = true; });
    matching.slice(0, visibleCount).forEach((post) => { post.hidden = false; });
    controls.hidden = matching.length <= visibleCount;
    if (clearSearch) clearSearch.hidden = searchTerms.length === 0;
    if (searchCount) {
      searchCount.textContent = searchTerms.length
        ? `${matching.length} ${matching.length === 1 ? "αποτέλεσμα" : "αποτελέσματα"}`
        : "";
    }
    syncSidebarHeight();
  };

  const revealSharedPost = () => {
    const targetId = decodeURIComponent(window.location.hash.slice(1));
    const target = targetId ? document.getElementById(targetId) : null;
    const postIndex = posts.indexOf(target);
    if (postIndex < 0) return;

    activeArtist = "";
    visibleCount = Math.max(pageSize, Math.ceil((postIndex + 1) / pageSize) * pageSize);
    filters.forEach((item) => {
      const active = !item.dataset.artistFilter;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    render();
    window.requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
  };

  filters.forEach((filter) => {
    filter.addEventListener("click", () => {
      activeArtist = filter.dataset.artistFilter || "";
      visibleCount = pageSize;
      filters.forEach((item) => {
        const active = item === filter;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      render();
      releases?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  searchInput?.addEventListener("input", () => {
    searchTerms = normalize(searchInput.value).trim().split(/\s+/).filter(Boolean);
    visibleCount = pageSize;
    render();
  });

  clearSearch?.addEventListener("click", () => {
    searchInput.value = "";
    searchTerms = [];
    visibleCount = pageSize;
    render();
    searchInput.focus();
  });

  moreButton.addEventListener("click", () => {
    visibleCount += pageSize;
    render();
  });

  render();
  if (releases && "ResizeObserver" in window) {
    new ResizeObserver(syncSidebarHeight).observe(releases);
  }
  window.addEventListener("resize", syncSidebarHeight);
  revealSharedPost();
  window.addEventListener("hashchange", revealSharedPost);
});
