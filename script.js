/* =========================================================
   CONFIG
========================================================= */

const DB_NAME = "lidosDatabase";
const DB_VERSION = 1;
const STORE_NAME = "books";

const MAX_FILE_SIZE = 15 * 1024 * 1024;

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;


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

const shareProgressBar = document.querySelector("#shareProgressBar");
const shareProgressText = document.querySelector("#shareProgressText");


/* =========================================================
   STATE
========================================================= */

let database = null;

let books = [];

let galleryObjectUrls = [];
let previewObjectUrls = [];

let latestStoryBlob = null;

let storyGenerationVersion = 0;


/* =========================================================
   INDEXED DB
========================================================= */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      database = request.result;

      resolve(database);
    };

    request.onupgradeneeded = event => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(
          STORE_NAME,
          {
            keyPath: "id",
            autoIncrement: true
          }
        );

        store.createIndex(
          "createdAt",
          "createdAt",
          {
            unique: false
          }
        );
      }
    };
  });
}


function addBook(file) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      STORE_NAME,
      "readwrite"
    );

    const store = transaction.objectStore(STORE_NAME);

    const request = store.add({
      cover: file,
      createdAt: Date.now()
    });

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}


function getAllBooks() {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      STORE_NAME,
      "readonly"
    );

    const store = transaction.objectStore(STORE_NAME);

    const request = store.getAll();

    request.onsuccess = () => {
      const result = request.result || [];

      result.sort((a, b) => {
        if (b.createdAt !== a.createdAt) {
          return b.createdAt - a.createdAt;
        }

        return b.id - a.id;
      });

      resolve(result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}


function deleteBook(id) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      STORE_NAME,
      "readwrite"
    );

    const store = transaction.objectStore(STORE_NAME);

    const request = store.delete(id);

    request.onsuccess = () => resolve();

    request.onerror = () => reject(request.error);
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
    setStatus(
      "Escolha um arquivo de imagem.",
      "error"
    );

    return;
  }


  if (file.size > MAX_FILE_SIZE) {
    setStatus(
      "Essa imagem é muito grande. Use um arquivo de até 15 MB.",
      "error"
    );

    return;
  }


  try {
    setStatus("Adicionando capa...");

    await addBook(file);

    await refreshLibrary();

    setStatus(
      "Capa adicionada à biblioteca.",
      "success"
    );

  } catch (error) {

    console.error(error);

    setStatus(
      "Não foi possível salvar essa capa.",
      "error"
    );
  }
}


/* =========================================================
   DRAG AND DROP
========================================================= */

[
  "dragenter",
  "dragover"
].forEach(eventName => {

  dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    event.stopPropagation();

    dropzone.classList.add("is-dragging");
  });

});


[
  "dragleave",
  "drop"
].forEach(eventName => {

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

  uploadStatus.classList.remove(
    "success",
    "error"
  );

  if (type) {
    uploadStatus.classList.add(type);
  }
}


/* =========================================================
   REFRESH
========================================================= */

async function refreshLibrary() {

  books = await getAllBooks();

  renderLibrary();
  renderStoryPreview();
  updateCounters();

  prepareStoryImage();
}


/* =========================================================
   COUNTERS
========================================================= */

function updateCounters() {

  const total = books.length;

  libraryCount.textContent =
    `${total} ${total === 1 ? "livro" : "livros"}`;

  sectionCounter.textContent =
    `${total} ${total === 1 ? "capa" : "capas"}`;


  const available = Math.min(total, 6);

  shareProgressText.textContent =
    `${available} de 6 livros`;

  shareProgressBar.style.width =
    `${(available / 6) * 100}%`;
}


/* =========================================================
   RENDER LIBRARY
========================================================= */

function revokeGalleryUrls() {

  galleryObjectUrls.forEach(url => {
    URL.revokeObjectURL(url);
  });

  galleryObjectUrls = [];
}


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

    const card = document.createElement("article");

    card.className = "book-card";

    card.style.animationDelay =
      `${Math.min(index * 35, 300)}ms`;


    const image = document.createElement("img");

    const imageUrl =
      URL.createObjectURL(book.cover);

    galleryObjectUrls.push(imageUrl);

    image.src = imageUrl;

    image.className = "book-cover";

    image.alt =
      `Capa do livro ${books.length - index}`;

    image.loading = "lazy";

    image.decoding = "async";


    const deleteButton =
      document.createElement("button");

    deleteButton.type = "button";

    deleteButton.className = "delete-book";

    deleteButton.dataset.id = book.id;

    deleteButton.setAttribute(
      "aria-label",
      "Remover esta capa"
    );

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


    card.appendChild(image);
    card.appendChild(deleteButton);

    fragment.appendChild(card);
  });


  bookGrid.appendChild(fragment);
}


/* =========================================================
   DELETE
========================================================= */

bookGrid.addEventListener("click", async event => {

  const button =
    event.target.closest(".delete-book");

  if (!button) {
    return;
  }


  const id = Number(button.dataset.id);


  const shouldDelete = window.confirm(
    "Remover esta capa da biblioteca?"
  );


  if (!shouldDelete) {
    return;
  }


  try {

    await deleteBook(id);

    await refreshLibrary();

    setStatus(
      "Capa removida.",
      "success"
    );

  } catch (error) {

    console.error(error);

    setStatus(
      "Não foi possível remover a capa.",
      "error"
    );
  }
});


/* =========================================================
   STORY MINI PREVIEW
========================================================= */

function revokePreviewUrls() {

  previewObjectUrls.forEach(url => {
    URL.revokeObjectURL(url);
  });

  previewObjectUrls = [];
}


function renderStoryPreview() {

  revokePreviewUrls();

  storyGrid.innerHTML = "";

  const recentBooks =
    books.slice(0, 6);


  for (let i = 0; i < 6; i++) {

    const slot =
      document.createElement("div");

    slot.className = "story-slot";


    const book = recentBooks[i];


    if (!book) {

      slot.classList.add("empty");

      storyGrid.appendChild(slot);

      continue;
    }


    const image =
      document.createElement("img");

    const url =
      URL.createObjectURL(book.cover);

    previewObjectUrls.push(url);

    image.src = url;

    image.alt = "";

    image.decoding = "async";


    slot.appendChild(image);

    storyGrid.appendChild(slot);
  }
}


/* =========================================================
   STORY GENERATION
========================================================= */

async function prepareStoryImage() {

  const version =
    ++storyGenerationVersion;


  latestStoryBlob = null;


  if (books.length < 6) {

    shareButton.disabled = true;

    const missing = 6 - books.length;

    shareButtonText.textContent =
      missing === 1
        ? "Falta 1 livro"
        : `Faltam ${missing} livros`;

    return;
  }


  shareButton.disabled = true;

  shareButtonText.textContent =
    "Preparando Story...";


  try {

    const blob =
      await createStoryImage(
        books.slice(0, 6)
      );


    /*
      Caso a biblioteca tenha mudado enquanto
      o Story estava sendo gerado, ignoramos
      a imagem antiga.
    */
    if (version !== storyGenerationVersion) {
      return;
    }


    latestStoryBlob = blob;

    shareButton.disabled = false;

    shareButtonText.textContent =
      "Compartilhar Story";


  } catch (error) {

    console.error(
      "Erro ao gerar Story:",
      error
    );


    if (version !== storyGenerationVersion) {
      return;
    }


    shareButton.disabled = true;

    shareButtonText.textContent =
      "Erro ao gerar Story";
  }
}


/* =========================================================
   CANVAS
========================================================= */

async function createStoryImage(recentBooks) {

  const canvas =
    document.createElement("canvas");

  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;


  const ctx =
    canvas.getContext("2d");


  drawStoryBackground(ctx);

  drawStoryHeader(ctx);


  const loadedImages =
    await Promise.all(
      recentBooks.map(book =>
        loadImageFromBlob(book.cover)
      )
    );


  const cardWidth = 304;
  const cardHeight = 456;

  const columnGap = 48;
  const rowGap = 32;

  const totalGridWidth =
    cardWidth * 2 + columnGap;

  const startX =
    (STORY_WIDTH - totalGridWidth) / 2;

  const startY = 328;


  loadedImages.forEach((image, index) => {

    const column = index % 2;

    const row = Math.floor(index / 2);


    const x =
      startX +
      column * (cardWidth + columnGap);

    const y =
      startY +
      row * (cardHeight + rowGap);


    drawStoryBook(
      ctx,
      image,
      x,
      y,
      cardWidth,
      cardHeight
    );
  });


  drawStoryFooter(ctx);


  return canvasToBlob(canvas);
}


/* =========================================================
   STORY BACKGROUND
========================================================= */

function drawStoryBackground(ctx) {

  const gradient =
    ctx.createLinearGradient(
      0,
      0,
      STORY_WIDTH,
      STORY_HEIGHT
    );


  gradient.addColorStop(
    0,
    "#08080c"
  );

  gradient.addColorStop(
    0.55,
    "#0b0a11"
  );

  gradient.addColorStop(
    1,
    "#07070a"
  );


  ctx.fillStyle = gradient;

  ctx.fillRect(
    0,
    0,
    STORY_WIDTH,
    STORY_HEIGHT
  );


  /*
    Glow superior
  */

  const glowTop =
    ctx.createRadialGradient(
      880,
      220,
      0,
      880,
      220,
      520
    );


  glowTop.addColorStop(
    0,
    "rgba(147, 117, 255, 0.18)"
  );

  glowTop.addColorStop(
    1,
    "rgba(147, 117, 255, 0)"
  );


  ctx.fillStyle = glowTop;

  ctx.fillRect(
    0,
    0,
    STORY_WIDTH,
    STORY_HEIGHT
  );


  /*
    Glow inferior
  */

  const glowBottom =
    ctx.createRadialGradient(
      80,
      1670,
      0,
      80,
      1670,
      520
    );


  glowBottom.addColorStop(
    0,
    "rgba(82, 120, 210, 0.11)"
  );

  glowBottom.addColorStop(
    1,
    "rgba(82, 120, 210, 0)"
  );


  ctx.fillStyle = glowBottom;

  ctx.fillRect(
    0,
    0,
    STORY_WIDTH,
    STORY_HEIGHT
  );
}


/* =========================================================
   STORY HEADER
========================================================= */

function drawStoryHeader(ctx) {

  ctx.textAlign = "center";

  ctx.fillStyle =
    "rgba(255,255,255,0.42)";

  ctx.font =
    '600 28px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

  ctx.fillText(
    "lidos.",
    STORY_WIDTH / 2,
    103
  );


  ctx.fillStyle =
    "rgba(255,255,255,0.96)";

  ctx.font =
    '750 60px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

  ctx.fillText(
    "ÚLTIMAS LEITURAS",
    STORY_WIDTH / 2,
    196
  );


  ctx.fillStyle =
    "rgba(255,255,255,0.38)";

  ctx.font =
    '400 27px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

  ctx.fillText(
    "",
    STORY_WIDTH / 2,
    248
  );
}


/* =========================================================
   DRAW BOOK
========================================================= */

function drawStoryBook(
  ctx,
  image,
  x,
  y,
  width,
  height
) {

  ctx.save();


  /*
    Shadow
  */

  ctx.shadowColor =
    "rgba(0,0,0,0.46)";

  ctx.shadowBlur = 38;

  ctx.shadowOffsetY = 20;


  roundedRectPath(
    ctx,
    x,
    y,
    width,
    height,
    26
  );


  ctx.fillStyle =
    "rgba(20,20,25,0.95)";

  ctx.fill();


  ctx.shadowColor =
    "transparent";


  /*
    Clip
  */

  roundedRectPath(
    ctx,
    x,
    y,
    width,
    height,
    26
  );

  ctx.clip();


  drawImageCover(
    ctx,
    image,
    x,
    y,
    width,
    height
  );


  /*
    Vignette discreta
  */

  const vignette =
    ctx.createLinearGradient(
      x,
      y,
      x,
      y + height
    );


  vignette.addColorStop(
    0,
    "rgba(0,0,0,0)"
  );

  vignette.addColorStop(
    0.78,
    "rgba(0,0,0,0)"
  );

  vignette.addColorStop(
    1,
    "rgba(0,0,0,0.1)"
  );


  ctx.fillStyle = vignette;

  ctx.fillRect(
    x,
    y,
    width,
    height
  );


  ctx.restore();


  /*
    Border
  */

  ctx.save();

  roundedRectPath(
    ctx,
    x,
    y,
    width,
    height,
    26
  );

  ctx.strokeStyle =
    "rgba(255,255,255,0.13)";

  ctx.lineWidth = 2;

  ctx.stroke();

  ctx.restore();
}


/* =========================================================
   IMAGE COVER CROP
========================================================= */

function drawImageCover(
  ctx,
  image,
  x,
  y,
  width,
  height
) {

  const imageRatio =
    image.width / image.height;

  const targetRatio =
    width / height;


  let sourceX = 0;
  let sourceY = 0;

  let sourceWidth = image.width;
  let sourceHeight = image.height;


  if (imageRatio > targetRatio) {

    sourceWidth =
      image.height * targetRatio;

    sourceX =
      (image.width - sourceWidth) / 2;

  } else {

    sourceHeight =
      image.width / targetRatio;

    sourceY =
      (image.height - sourceHeight) / 2;
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
   STORY FOOTER
========================================================= */

function drawStoryFooter(ctx) {

  ctx.textAlign = "center";

  ctx.fillStyle =
    "rgba(255,255,255,0.3)";

  ctx.font =
    '500 22px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';


  ctx.fillText(
    "minhas últimas leituras",
    STORY_WIDTH / 2,
    1848
  );


  ctx.fillStyle =
    "rgba(255,255,255,0.17)";

  ctx.font =
    '600 18px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';


  ctx.fillText(
    "LIDOS.",
    STORY_WIDTH / 2,
    1887
  );
}


/* =========================================================
   ROUNDED RECT
========================================================= */

function roundedRectPath(
  ctx,
  x,
  y,
  width,
  height,
  radius
) {

  const r = Math.min(
    radius,
    width / 2,
    height / 2
  );


  ctx.beginPath();

  ctx.moveTo(
    x + r,
    y
  );

  ctx.lineTo(
    x + width - r,
    y
  );

  ctx.quadraticCurveTo(
    x + width,
    y,
    x + width,
    y + r
  );

  ctx.lineTo(
    x + width,
    y + height - r
  );

  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - r,
    y + height
  );

  ctx.lineTo(
    x + r,
    y + height
  );

  ctx.quadraticCurveTo(
    x,
    y + height,
    x,
    y + height - r
  );

  ctx.lineTo(
    x,
    y + r
  );

  ctx.quadraticCurveTo(
    x,
    y,
    x + r,
    y
  );

  ctx.closePath();
}


/* =========================================================
   IMAGE LOADER
========================================================= */

function loadImageFromBlob(blob) {

  return new Promise(
    (resolve, reject) => {

      const image =
        new Image();

      const url =
        URL.createObjectURL(blob);


      image.onload = () => {

        URL.revokeObjectURL(url);

        resolve(image);
      };


      image.onerror = () => {

        URL.revokeObjectURL(url);

        reject(
          new Error(
            "Não foi possível carregar uma das capas."
          )
        );
      };


      image.src = url;
    }
  );
}


/* =========================================================
   CANVAS TO BLOB
========================================================= */

function canvasToBlob(canvas) {

  return new Promise(
    (resolve, reject) => {

      canvas.toBlob(
        blob => {

          if (!blob) {

            reject(
              new Error(
                "Não foi possível gerar a imagem."
              )
            );

            return;
          }


          resolve(blob);
        },

        "image/png",
        1
      );
    }
  );
}


/* =========================================================
   SHARE
========================================================= */

shareButton.addEventListener(
  "click",
  async () => {

    if (!latestStoryBlob) {
      return;
    }


    const file =
      new File(
        [latestStoryBlob],
        "minhas-ultimas-leituras.png",
        {
          type: "image/png"
        }
      );


    /*
      Mobile / Web Share API
    */

    const supportsFileSharing =
      navigator.share &&
      navigator.canShare &&
      navigator.canShare({
        files: [file]
      });


    if (supportsFileSharing) {

      try {

        await navigator.share({
          files: [file],
          title: "Minhas últimas leituras"
        });


        setStatus(
          "Story pronto para compartilhar.",
          "success"
        );


      } catch (error) {

        /*
          O usuário apenas fechou a tela
          de compartilhamento.
        */

        if (error.name !== "AbortError") {

          console.error(error);

          downloadStory(latestStoryBlob);
        }
      }


      return;
    }


    /*
      Desktop ou navegador sem compartilhamento
      de arquivos: baixa automaticamente.
    */

    downloadStory(latestStoryBlob);
  }
);


/* =========================================================
   DOWNLOAD FALLBACK
========================================================= */

function downloadStory(blob) {

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");


  link.href = url;

  link.download =
    "minhas-ultimas-leituras-story.png";


  document.body.appendChild(link);

  link.click();

  link.remove();


  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);


  setStatus(
    "Story salvo como imagem.",
    "success"
  );
}


/* =========================================================
   CLEANUP
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    revokeGalleryUrls();
    revokePreviewUrls();
  }
);


/* =========================================================
   START
========================================================= */

async function init() {

  if (!("indexedDB" in window)) {

    setStatus(
      "Este navegador não oferece o armazenamento necessário.",
      "error"
    );

    return;
  }


  try {

    await openDatabase();

    await refreshLibrary();

  } catch (error) {

    console.error(error);

    setStatus(
      "Não foi possível abrir sua biblioteca.",
      "error"
    );
  }
}


init();
