const DB_NAME = "lidosDatabase";
const DB_VERSION = 1;
const STORE_NAME = "books";

const MAX_FILE_SIZE = 15 * 1024 * 1024;

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;
const MAX_STORY_BOOKS = 8;

/* =========================================================
   ELEMENTS
========================================================= */

const uploadForm = document.querySelector("#uploadForm");
const coverInput = document.querySelector("#coverInput");
const dropzone = document.querySelector("#dropzone");
const uploadStatus = document.querySelector("#uploadStatus");

const bookGrid = document.querySelector("#bookGrid");
const emptyState = document.querySelector("#emptyState");

const libraryCount = document.querySelector("#libraryCount");
const sectionCounter = document.querySelector("#sectionCounter");

const storyGrid = document.querySelector("#storyGrid");

const shareButton = document.querySelector("#shareButton");
const shareButtonText = document.querySelector("#shareButtonText");

const decreaseCount = document.querySelector("#decreaseCount");
const increaseCount = document.querySelector("#increaseCount");
const selectedCountValue = document.querySelector("#selectedCountValue");
const selectedCountLabel = document.querySelector("#selectedCountLabel");
const shareAvailability = document.querySelector("#shareAvailability");
const shareSelectionText = document.querySelector("#shareSelectionText");

/* =========================================================
   STATE
========================================================= */

let database = null;
let books = [];

let galleryObjectUrls = [];
let previewObjectUrls = [];

let latestStoryBlob = null;
let storyGenerationVersion = 0;

let selectedStoryCount = 0;
let hasUserAdjustedCount = false;

/* =========================================================
   DB
========================================================= */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      database = request.result;
      resolve(database);
    };

    request.onupgradeneeded = event => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true
        });

        store.createIndex("createdAt", "createdAt", {
          unique: false
        });
      }
    };
  });
}

function normalizeBook(book) {
  return {
    id: book.id,
    cover: book.cover,
    createdAt: typeof book.createdAt === "number" ? book.createdAt : Date.now(),
    rating: clampRating(Number.isFinite(book.rating) ? book.rating : 0)
  };
}

function clampRating(value) {
  return Math.max(0, Math.min(5, Number(value) || 0));
}

function addBook(file) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.add({
      cover: file,
      createdAt: Date.now(),
      rating: 0
    });

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllBooks() {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const result = (request.result || [])
        .map(normalizeBook)
        .sort((a, b) => {
          if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
          return b.id - a.id;
        });

      resolve(result);
    };

    request.onerror = () => reject(request.error);
  });
}

function deleteBook(id) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function updateBookRating(id, rating) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const getRequest = store.get(id);

    getRequest.onerror = () => reject(getRequest.error);

    getRequest.onsuccess = () => {
      const existing = getRequest.result;

      if (!existing) {
        reject(new Error("Livro não encontrado."));
        return;
      }

      const normalized = normalizeBook(existing);
      normalized.rating = clampRating(rating);

      const putRequest = store.put(normalized);

      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
  });
}

/* =========================================================
   UPLOAD
========================================================= */

uploadForm.addEventListener("submit", event => {
  event.preventDefault();
});

coverInput.addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (file) {
    await handleCoverUpload(file);
  }

  coverInput.value = "";
});

async function handleCoverUpload(file) {
  if (!file.type.startsWith("image/")) {
    setStatus("Escolha um arquivo de imagem.", "error");
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    setStatus("Essa imagem é muito grande. Use um arquivo de até 15 MB.", "error");
    return;
  }

  try {
    setStatus("Adicionando capa...");

    await addBook(file);

    if (!hasUserAdjustedCount) {
      selectedStoryCount = Math.min(MAX_STORY_BOOKS, books.length + 1);
    }

    await refreshLibrary();

    setStatus("Capa adicionada à biblioteca.", "success");
  } catch (error) {
    console.error(error);
    setStatus("Não foi possível salvar essa capa.", "error");
  }
}

/* =========================================================
   DRAG AND DROP
========================================================= */

["dragenter", "dragover"].forEach(eventName => {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach(eventName => {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("is-dragging");
  });
});

dropzone.addEventListener("drop", async event => {
  const file = event.dataTransfer?.files?.[0];

  if (file) {
    await handleCoverUpload(file);
  }
});

/* =========================================================
   STATUS
========================================================= */

function setStatus(message = "", type = "") {
  uploadStatus.textContent = message;
  uploadStatus.classList.remove("success", "error");

  if (type) {
    uploadStatus.classList.add(type);
  }
}

/* =========================================================
   REFRESH
========================================================= */

async function refreshLibrary() {
  books = await getAllBooks();

  syncSelectedStoryCount();

  renderLibrary();
  updateCounters();
  updateStoryControls();
  renderStoryPreview();

  prepareStoryImage();
}

/* =========================================================
   COUNT LOGIC
========================================================= */

function getMaxSelectableCount() {
  return Math.min(MAX_STORY_BOOKS, books.length);
}

function syncSelectedStoryCount() {
  const maxSelectable = getMaxSelectableCount();

  if (maxSelectable === 0) {
    selectedStoryCount = 0;
    return;
  }

  if (!hasUserAdjustedCount) {
    selectedStoryCount = maxSelectable;
    return;
  }

  selectedStoryCount = Math.max(1, Math.min(selectedStoryCount, maxSelectable));
}

function adjustSelectedStoryCount(delta) {
  const maxSelectable = getMaxSelectableCount();

  if (maxSelectable === 0) return;

  hasUserAdjustedCount = true;

  selectedStoryCount = Math.max(
    1,
    Math.min(selectedStoryCount + delta, maxSelectable)
  );

  updateStoryControls();
  renderStoryPreview();
  prepareStoryImage();
}

/* =========================================================
   COUNTERS
========================================================= */

function updateCounters() {
  const total = books.length;

  libraryCount.textContent = `${total} ${total === 1 ? "livro" : "livros"}`;
  sectionCounter.textContent = `${total} ${total === 1 ? "capa" : "capas"}`;
}

function updateStoryControls() {
  const total = books.length;
  const maxSelectable = getMaxSelectableCount();

  selectedCountValue.textContent = selectedStoryCount || 0;
  selectedCountLabel.textContent =
    selectedStoryCount === 1
      ? "1 livro"
      : `${selectedStoryCount || 0} livros`;

  shareAvailability.textContent =
    total === 0
      ? "Adicione ao menos 1 capa para gerar o Story."
      : `${total} ${total === 1 ? "capa disponível" : "capas disponíveis"} • até ${MAX_STORY_BOOKS} por Story`;

  shareSelectionText.textContent =
    selectedStoryCount > 0
      ? `Você está exportando ${selectedStoryCount} ${selectedStoryCount === 1 ? "capa" : "capas"}.`
      : "Nenhuma capa selecionada.";

  decreaseCount.disabled = selectedStoryCount <= 1;
  increaseCount.disabled = total === 0 || selectedStoryCount >= maxSelectable;
}

decreaseCount.addEventListener("click", () => adjustSelectedStoryCount(-1));
increaseCount.addEventListener("click", () => adjustSelectedStoryCount(1));

/* =========================================================
   URL CLEANUP
========================================================= */

function revokeGalleryUrls() {
  galleryObjectUrls.forEach(url => URL.revokeObjectURL(url));
  galleryObjectUrls = [];
}

function revokePreviewUrls() {
  previewObjectUrls.forEach(url => URL.revokeObjectURL(url));
  previewObjectUrls = [];
}

/* =========================================================
   RENDER LIBRARY
========================================================= */

function renderLibrary() {
  revokeGalleryUrls();
  bookGrid.innerHTML = "";

  if (books.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");

  const fragment = document.createDocumentFragment();

  books.forEach((book, index) => {
    const item = document.createElement("article");
    item.className = "book-item";
    item.style.animationDelay = `${Math.min(index * 35, 300)}ms`;

    const card = document.createElement("div");
    card.className = "book-card";

    const image = document.createElement("img");
    const imageUrl = URL.createObjectURL(book.cover);

    galleryObjectUrls.push(imageUrl);

    image.src = imageUrl;
    image.className = "book-cover";
    image.alt = `Capa do livro ${books.length - index}`;
    image.loading = "lazy";
    image.decoding = "async";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-book";
    deleteButton.dataset.id = book.id;
    deleteButton.setAttribute("aria-label", "Remover esta capa");
    deleteButton.innerHTML = `
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 6h18"></path>
        <path d="M8 6V4h8v2"></path>
        <path d="M19 6l-1 14H6L5 6"></path>
        <path d="M10 11v5"></path>
        <path d="M14 11v5"></path>
      </svg>
    `;

    const ratingPanel = document.createElement("div");
    ratingPanel.className = "rating-panel glass";

    const ratingGroup = document.createElement("div");
    ratingGroup.className = "star-rating";
    ratingGroup.setAttribute("role", "group");
    ratingGroup.setAttribute("aria-label", "Dar nota de 0 a 5 estrelas");

    for (let value = 1; value <= 5; value++) {
      const starButton = document.createElement("button");
      starButton.type = "button";
      starButton.className = `star-button ${value <= book.rating ? "active" : ""}`;
      starButton.dataset.id = book.id;
      starButton.dataset.value = value;
      starButton.setAttribute("aria-label", `Dar nota ${value} de 5`);
      starButton.title = value <= book.rating && value === book.rating
        ? "Clique novamente para zerar"
        : `Nota ${value}`;

      starButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.8l2.8 5.68 6.27.91-4.54 4.42 1.07 6.25L12 17.12 6.4 20.06l1.07-6.25L2.93 9.39l6.27-.91L12 2.8z"></path>
        </svg>
      `;

      ratingGroup.appendChild(starButton);
    }

    const ratingLabel = document.createElement("span");
    ratingLabel.className = "rating-label";
    ratingLabel.textContent = book.rating === 0 ? "Sem nota" : `${book.rating}/5`;

    card.appendChild(image);
    card.appendChild(deleteButton);

    ratingPanel.appendChild(ratingGroup);
    ratingPanel.appendChild(ratingLabel);

    item.appendChild(card);
    item.appendChild(ratingPanel);

    fragment.appendChild(item);
  });

  bookGrid.appendChild(fragment);
}

/* =========================================================
   EVENTS: DELETE + RATING
========================================================= */

bookGrid.addEventListener("click", async event => {
  const deleteBtn = event.target.closest(".delete-book");

  if (deleteBtn) {
    const id = Number(deleteBtn.dataset.id);

    const shouldDelete = window.confirm("Remover esta capa da biblioteca?");
    if (!shouldDelete) return;

    try {
      await deleteBook(id);
      await refreshLibrary();
      setStatus("Capa removida.", "success");
    } catch (error) {
      console.error(error);
      setStatus("Não foi possível remover a capa.", "error");
    }

    return;
  }

  const starBtn = event.target.closest(".star-button");

  if (starBtn) {
    const id = Number(starBtn.dataset.id);
    const value = Number(starBtn.dataset.value);

    const currentBook = books.find(book => book.id === id);
    if (!currentBook) return;

    const nextRating = currentBook.rating === value ? 0 : value;

    try {
      await updateBookRating(id, nextRating);
      await refreshLibrary();
      setStatus(
        nextRating === 0
          ? "Nota removida."
          : `Nota ${nextRating}/5 salva.`,
        "success"
      );
    } catch (error) {
      console.error(error);
      setStatus("Não foi possível salvar a nota.", "error");
    }
  }
});

/* =========================================================
   STORY PREVIEW
========================================================= */

function getStoryColumns(count) {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

function renderStoryPreview() {
  revokePreviewUrls();
  storyGrid.innerHTML = "";

  const countForPreview = selectedStoryCount || 0;
  const booksForPreview = books.slice(0, countForPreview);

  if (countForPreview === 0) {
    storyGrid.style.setProperty("--story-cols", 2);

    for (let i = 0; i < 4; i++) {
      const slot = createEmptyStorySlot();
      storyGrid.appendChild(slot);
    }

    return;
  }

  const cols = getStoryColumns(countForPreview);
  storyGrid.style.setProperty("--story-cols", cols);

  booksForPreview.forEach(book => {
    const slot = document.createElement("div");
    slot.className = "story-slot";

    const cover = document.createElement("div");
    cover.className = "story-slot-cover";

    const img = document.createElement("img");
    const url = URL.createObjectURL(book.cover);

    previewObjectUrls.push(url);

    img.src = url;
    img.alt = "";
    img.decoding = "async";

    const stars = document.createElement("div");
    stars.className = "story-slot-stars";

    for (let value = 1; value <= 5; value++) {
      const star = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      star.setAttribute("viewBox", "0 0 24 24");
      star.setAttribute("class", `story-slot-star ${value <= book.rating ? "active" : ""}`);
      star.innerHTML = `<path d="M12 2.8l2.8 5.68 6.27.91-4.54 4.42 1.07 6.25L12 17.12 6.4 20.06l1.07-6.25L2.93 9.39l6.27-.91L12 2.8z"></path>`;
      stars.appendChild(star);
    }

    cover.appendChild(img);
    slot.appendChild(cover);
    slot.appendChild(stars);

    storyGrid.appendChild(slot);
  });
}

function createEmptyStorySlot() {
  const slot = document.createElement("div");
  slot.className = "story-slot empty";

  const cover = document.createElement("div");
  cover.className = "story-slot-cover";

  const stars = document.createElement("div");
  stars.className = "story-slot-stars";

  slot.appendChild(cover);
  slot.appendChild(stars);

  return slot;
}

/* =========================================================
   STORY GENERATION
========================================================= */

async function prepareStoryImage() {
  const version = ++storyGenerationVersion;
  latestStoryBlob = null;

  if (selectedStoryCount <= 0 || books.length === 0) {
    shareButton.disabled = true;
    shareButtonText.textContent = "Adicione ao menos 1 livro";
    return;
  }

  shareButton.disabled = true;
  shareButtonText.textContent = "Preparando Story...";

  try {
    const exportBooks = books.slice(0, selectedStoryCount);
    const blob = await createStoryImage(exportBooks);

    if (version !== storyGenerationVersion) return;

    latestStoryBlob = blob;
    shareButton.disabled = false;
    shareButtonText.textContent = "Compartilhar Story";
  } catch (error) {
    console.error("Erro ao gerar Story:", error);

    if (version !== storyGenerationVersion) return;

    shareButton.disabled = true;
    shareButtonText.textContent = "Erro ao gerar Story";
  }
}

/* =========================================================
   CANVAS
========================================================= */

async function createStoryImage(exportBooks) {
  const canvas = document.createElement("canvas");
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;

  const ctx = canvas.getContext("2d");

  drawStoryBackground(ctx);
  drawStoryHeader(ctx);

  const loadedImages = await Promise.all(
    exportBooks.map(book => loadImageFromBlob(book.cover))
  );

  const count = exportBooks.length;
  const cols = getStoryColumns(count);
  const rows = Math.ceil(count / cols);

  const layout = calculateStoryLayout({
    count,
    cols,
    rows
  });

  loadedImages.forEach((image, index) => {
    const column = index % cols;
    const row = Math.floor(index / cols);

    const x = layout.startX + column * (layout.coverWidth + layout.colGap);
    const y = layout.startY + row * (layout.cellHeight + layout.rowGap);

    drawStoryBook(ctx, image, x, y, layout.coverWidth, layout.coverHeight);
    drawStoryRating(
      ctx,
      exportBooks[index].rating,
      x + layout.coverWidth / 2,
      y + layout.coverHeight + layout.ratingOffsetY,
      layout.starSize,
      layout.starGap
    );
  });

  return canvasToBlob(canvas);
}

function calculateStoryLayout({ count, cols, rows }) {
  const sidePadding = cols === 1 ? 190 : cols === 2 ? 120 : 90;
  const topArea = 280;
  const bottomArea = 90;

  const colGap = cols === 1 ? 0 : cols === 2 ? 42 : 24;
  const rowGap = rows >= 4 ? 24 : rows === 3 ? 28 : 34;

  const starArea = rows >= 4 ? 42 : 50;

  const availableWidth = STORY_WIDTH - sidePadding * 2 - colGap * (cols - 1);
  const availableHeight = STORY_HEIGHT - topArea - bottomArea - rowGap * (rows - 1);

  const maxWidthByCanvas = availableWidth / cols;
  const maxCoverHeightByCanvas = availableHeight / rows - starArea;

  let coverWidth = Math.min(maxWidthByCanvas, maxCoverHeightByCanvas * (2 / 3));
  let coverHeight = coverWidth * 1.5;

  const cellHeight = coverHeight + starArea;
  const gridWidth = cols * coverWidth + colGap * (cols - 1);
  const gridHeight = rows * cellHeight + rowGap * (rows - 1);

  const startX = (STORY_WIDTH - gridWidth) / 2;
  const startY = topArea + (STORY_HEIGHT - topArea - bottomArea - gridHeight) / 2;

  const starSize = rows >= 4 ? 28 : rows === 3 ? 30 : 34;
  const starGap = rows >= 4 ? 8 : 10;
  const ratingOffsetY = rows >= 4 ? 28 : 32;

  return {
    coverWidth,
    coverHeight,
    cellHeight,
    colGap,
    rowGap,
    startX,
    startY,
    starSize,
    starGap,
    ratingOffsetY
  };
}

/* =========================================================
   DRAW BACKGROUND + HEADER
========================================================= */

function drawStoryBackground(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, STORY_WIDTH, STORY_HEIGHT);
  gradient.addColorStop(0, "#08080c");
  gradient.addColorStop(0.55, "#0b0a11");
  gradient.addColorStop(1, "#07070a");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  const glowTop = ctx.createRadialGradient(880, 220, 0, 880, 220, 520);
  glowTop.addColorStop(0, "rgba(147, 117, 255, 0.18)");
  glowTop.addColorStop(1, "rgba(147, 117, 255, 0)");

  ctx.fillStyle = glowTop;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  const glowBottom = ctx.createRadialGradient(80, 1670, 0, 80, 1670, 520);
  glowBottom.addColorStop(0, "rgba(82, 120, 210, 0.11)");
  glowBottom.addColorStop(1, "rgba(82, 120, 210, 0)");

  ctx.fillStyle = glowBottom;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
}

function drawStoryHeader(ctx) {
  ctx.textAlign = "center";

  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.font = '600 28px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
  ctx.fillText("lidos.", STORY_WIDTH / 2, 103);

  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.font = '750 60px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
  ctx.fillText("ÚLTIMAS LEITURAS", STORY_WIDTH / 2, 196);
}

/* =========================================================
   DRAW BOOK + STARS
========================================================= */

function drawStoryBook(ctx, image, x, y, width, height) {
  ctx.save();

  ctx.shadowColor = "rgba(0,0,0,0.46)";
  ctx.shadowBlur = 38;
  ctx.shadowOffsetY = 20;

  roundedRectPath(ctx, x, y, width, height, 26);
  ctx.fillStyle = "rgba(20,20,25,0.95)";
  ctx.fill();

  ctx.shadowColor = "transparent";

  roundedRectPath(ctx, x, y, width, height, 26);
  ctx.clip();

  drawImageCover(ctx, image, x, y, width, height);

  const vignette = ctx.createLinearGradient(x, y, x, y + height);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.78, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.1)");

  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, width, height);

  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, x, y, width, height, 26);
  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawStoryRating(ctx, rating, centerX, baselineY, starSize, gap) {
  const totalWidth = starSize * 5 + gap * 4;
  const startX = centerX - totalWidth / 2;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${starSize}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;

  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < rating ? "#f4cf6a" : "rgba(255,255,255,0.22)";
    ctx.fillText("★", startX + i * (starSize + gap), baselineY);
  }
}

/* =========================================================
   IMAGE CROP
========================================================= */

function drawImageCover(ctx, image, x, y, width, height) {
  const imageRatio = image.width / image.height;
  const targetRatio = width / height;

  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.width;
  let sourceHeight = image.height;

  if (imageRatio > targetRatio) {
    sourceWidth = image.height * targetRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceHeight = image.width / targetRatio;
    sourceY = (image.height - sourceHeight) / 2;
  }

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height
  );
}

/* =========================================================
   PATH
========================================================= */

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* =========================================================
   FILE / CANVAS HELPERS
========================================================= */

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível carregar uma das capas."));
    };

    image.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error("Não foi possível gerar a imagem."));
        return;
      }

      resolve(blob);
    }, "image/png", 1);
  });
}

/* =========================================================
   SHARE
========================================================= */

shareButton.addEventListener("click", async () => {
  if (!latestStoryBlob) return;

  const file = new File([latestStoryBlob], "minhas-ultimas-leituras.png", {
    type: "image/png"
  });

  const supportsFileSharing =
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({ files: [file] });

  if (supportsFileSharing) {
    try {
      await navigator.share({
        files: [file],
        title: "Minhas últimas leituras"
      });

      setStatus("Story pronto para compartilhar.", "success");
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error(error);
        downloadStory(latestStoryBlob);
      }
    }

    return;
  }

  downloadStory(latestStoryBlob);
});

function downloadStory(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "minhas-ultimas-leituras-story.png";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  setStatus("Story salvo como imagem.", "success");
}

/* =========================================================
   CLEANUP
========================================================= */

window.addEventListener("beforeunload", () => {
  revokeGalleryUrls();
  revokePreviewUrls();
});

/* =========================================================
   INIT
========================================================= */

async function init() {
  if (!("indexedDB" in window)) {
    setStatus("Este navegador não oferece o armazenamento necessário.", "error");
    return;
  }

  try {
    await openDatabase();
    await refreshLibrary();
  } catch (error) {
    console.error(error);
    setStatus("Não foi possível abrir sua biblioteca.", "error");
  }
}

init();
