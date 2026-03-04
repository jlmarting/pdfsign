import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';

import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

// Set worker path for pdf.js
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const editorSection = document.getElementById('editor-section');
const pdfCanvas = document.getElementById('pdf-canvas');
const drawingCanvas = document.getElementById('drawing-canvas');
const clearBtn = document.getElementById('clear-btn');
const downloadBtn = document.getElementById('download-btn');
const toast = document.getElementById('toast');
const filenameDisplay = document.getElementById('filename-display');
const fileInfo = document.getElementById('file-info');
const loadingOverlay = document.getElementById('loading-overlay');

let currentPdf = null;
let pdfDoc = null;
let pdfBytes = null;
let originalFileName = '';
let scale = 1.5;
let isDrawing = false;
let ctx = drawingCanvas.getContext('2d');

// --- Initialization ---

uploadZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', handleFileSelect);

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = 'var(--primary)';
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.style.borderColor = 'var(--border)';
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
        processFile(files[0]);
    } else {
        showToast('Por favor, selecciona un archivo PDF válido');
    }
});

function handleFileSelect(e) {
    if (e.target.files.length > 0) {
        processFile(e.target.files[0]);
    }
}

async function processFile(file) {
    originalFileName = file.name;
    const reader = new FileReader();
    reader.onload = async function () {
        try {
            loadingOverlay.style.display = 'flex';
            const arrayBuffer = this.result;

            // Create a dedicated copy for pdf-lib to avoid detachment issues
            pdfBytes = new Uint8Array(arrayBuffer.slice(0));

            console.log('PDF Loaded, bytes:', pdfBytes.length);
            console.log('First 5 bytes:', pdfBytes.slice(0, 5));

            await renderPdf(arrayBuffer.slice(0));

            uploadZone.classList.add('hidden');
            editorSection.style.display = 'flex';
            fileInfo.classList.remove('hidden');
            filenameDisplay.textContent = originalFileName;
            showToast('PDF cargado correctamente');
        } catch (err) {
            console.error('Error in processFile:', err);
            showToast('Error al procesar el PDF: ' + err.message);
        } finally {
            loadingOverlay.style.display = 'none';
        }
    };
    reader.readAsArrayBuffer(file);
}

async function renderPdf(data) {
    const loadingTask = pdfjsLib.getDocument({ data });
    pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1); // Render first page

    const viewport = page.getViewport({ scale });
    pdfCanvas.height = viewport.height;
    pdfCanvas.width = viewport.width;

    drawingCanvas.height = viewport.height;
    drawingCanvas.width = viewport.width;

    const renderContext = {
        canvasContext: pdfCanvas.getContext('2d'),
        viewport: viewport
    };

    await page.render(renderContext).promise;
    setupDrawing();
}

// --- Drawing Logic ---

function setupDrawing() {
    ctx.strokeStyle = '#000000'; // Signature color
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const getPos = (e) => {
        const rect = drawingCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    };

    const startDrawing = (e) => {
        isDrawing = true;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    };

    const draw = (e) => {
        if (!isDrawing) return;
        const pos = getPos(e);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    };

    const stopDrawing = () => {
        isDrawing = false;
    };

    drawingCanvas.addEventListener('mousedown', startDrawing);
    drawingCanvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', stopDrawing);

    drawingCanvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startDrawing(e);
    }, { passive: false });
    drawingCanvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        draw(e);
    }, { passive: false });
    window.addEventListener('touchend', stopDrawing);
}

clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
});

// --- Export Logic ---

downloadBtn.addEventListener('click', async () => {
    if (!pdfBytes) return;

    try {
        loadingOverlay.style.display = 'flex';
        showToast('Generando documento firmado...');

        console.log('Attempting to sign PDF. Bytes available:', pdfBytes ? pdfBytes.length : 0);
        if (pdfBytes) {
            console.log('PDF Header check:', pdfBytes.slice(0, 5));
        }

        // Give time for toast to show
        await new Promise(r => setTimeout(r, 100));

        // Load original PDF
        const pdfDocToSign = await PDFDocument.load(pdfBytes);
        const pages = pdfDocToSign.getPages();
        const firstPage = pages[0];
        const { width, height } = firstPage.getSize();

        // Capture signature as image
        // To be higher quality, we could redraw it but image is fine if resolution is high

        // Create a temporary canvas to flip the image vertically for PDF coordinate system
        const flipCanvas = document.createElement('canvas');
        flipCanvas.width = drawingCanvas.width;
        flipCanvas.height = drawingCanvas.height;
        const flipCtx = flipCanvas.getContext('2d');

        // PDF-lib coordinate system is (0,0) at bottom-left. 
        // We draw the signature on a transparent background.
        flipCtx.drawImage(drawingCanvas, 0, 0);

        const signatureImageBase64 = flipCanvas.toDataURL('image/png');
        const signatureImage = await pdfDocToSign.embedPng(signatureImageBase64);

        // Map dimensions from UI canvas back to PDF points
        // PDF units are usually points (1/72 inch). 
        // Our canvas size is viewport size (which is also points * scale).
        firstPage.drawImage(signatureImage, {
            x: 0,
            y: 0,
            width: width,
            height: height,
        });

        const signedPdfBytes = await pdfDocToSign.save();
        download(signedPdfBytes, `firmado_${originalFileName}`);
        showToast('¡Documento descargado!');
    } catch (err) {
        console.error(err);
        showToast('Error al firmar el documento');
    } finally {
        loadingOverlay.style.display = 'none';
    }
});

function download(data, name) {
    const blob = new Blob([data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
