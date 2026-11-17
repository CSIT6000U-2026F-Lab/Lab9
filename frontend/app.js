/**
 * Online Code Explorer
 * Loads Monaco Editor from a CDN and talks to the REST backend
 * for list / read / create / update / delete, plus a PyFlow call graph.
 */

/** CDN base used by both the AMD loader and web workers. */
const MONACO_BASE_URL = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.39.0/min';

/**
 * REST API origin. Serve the frontend from another origin (for example
 * Live Server at http://localhost:5500) so the browser sends CORS requests.
 */
const API_BASE = 'http://127.0.0.1:8000';

/** Map file extensions to Monaco language ids. */
const EXTENSION_LANGUAGE_MAP = {
    py: 'python',
    js: 'javascript',
    ts: 'typescript',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    txt: 'plaintext'
};

let editor = null;
let files = [];
let currentFileName = null;
let applyingEditorContent = false;
let statusTimer = null;
let discardResolve = null;

/** Last content known to be saved on the server, keyed by file name. */
const serverContent = new Map();

/** Unsaved editor drafts, keyed by file name. Only the Save button writes these to the API. */
const drafts = new Map();

/**
 * Infer a Monaco language id from a file name.
 * Falls back to plaintext when the extension is unknown.
 */
function detectLanguage(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    return EXTENSION_LANGUAGE_MAP[extension] || 'plaintext';
}

/**
 * Last saved text for a file, or an empty string if it has not been loaded yet.
 */
function savedText(fileName) {
    return serverContent.has(fileName) ? serverContent.get(fileName) : '';
}

/**
 * True when the open editor differs from the last saved version of that file.
 */
function isDirty() {
    if (!editor || !currentFileName) {
        return false;
    }
    return editor.getValue() !== savedText(currentFileName);
}

/**
 * True when a file has unsaved local edits (open editor or a stored draft).
 */
function fileHasDraft(fileName) {
    if (fileName === currentFileName) {
        return isDirty();
    }
    return drafts.has(fileName);
}

/**
 * Keep the current editor text in memory when it differs from the server copy.
 * Switching files does not ask to save; drafts stay until Save is clicked.
 */
function stashCurrentDraft() {
    if (!editor || !currentFileName) {
        return;
    }
    const text = editor.getValue();
    if (text !== savedText(currentFileName)) {
        drafts.set(currentFileName, text);
    } else {
        drafts.delete(currentFileName);
    }
}

/**
 * Sorted names of files that currently have unsaved local drafts.
 */
function unsavedFileNames() {
    stashCurrentDraft();
    return Array.from(drafts.keys()).sort();
}

/**
 * Ask the user to discard listed drafts. Resolves true to proceed, false to stay.
 * Skips the dialog when nothing is unsaved.
 */
function confirmDiscardUnsaved() {
    const names = unsavedFileNames();
    if (names.length === 0) {
        return Promise.resolve(true);
    }
    if (discardResolve) {
        return Promise.resolve(false);
    }

    const listEl = document.getElementById('discard-file-list');
    listEl.innerHTML = '';
    names.forEach((name) => {
        const item = document.createElement('li');
        item.textContent = name;
        listEl.appendChild(item);
    });

    document.getElementById('discard-overlay').hidden = false;
    document.getElementById('discard-cancel').focus();

    return new Promise((resolve) => {
        discardResolve = resolve;
    });
}

function closeDiscardModal(confirmed) {
    document.getElementById('discard-overlay').hidden = true;
    if (discardResolve) {
        const resolve = discardResolve;
        discardResolve = null;
        resolve(confirmed);
    }
}

function closeCallGraphPanel() {
    document.getElementById('callgraph-panel').hidden = true;
}

function isPythonFile(fileName) {
    return Boolean(fileName) && fileName.toLowerCase().endsWith('.py');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
let lastCallGraphName = 'callgraph';

function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach((key) => {
        el.setAttribute(key, attrs[key]);
    });
    return el;
}

function callGraphRoots(names, edges) {
    if (names.includes('<module>')) {
        return ['<module>'];
    }
    const callees = new Set((edges || []).map((edge) => edge[1]));
    const roots = names.filter((name) => !callees.has(name));
    return roots.length > 0 ? roots : names.slice(0, 1);
}

function layoutCallGraph(edges) {
    const names = [];
    const seen = new Set();
    function add(name) {
        if (!seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    }
    (edges || []).forEach((edge) => {
        add(edge[0]);
        add(edge[1]);
    });

    const adj = new Map(names.map((name) => [name, []]));
    (edges || []).forEach((edge) => {
        if (adj.has(edge[0])) {
            adj.get(edge[0]).push(edge[1]);
        }
    });

    const level = new Map();
    const queue = callGraphRoots(names, edges);
    queue.forEach((root) => level.set(root, 0));
    for (let i = 0; i < queue.length; i += 1) {
        const node = queue[i];
        (adj.get(node) || []).forEach((callee) => {
            const next = level.get(node) + 1;
            if (!level.has(callee)) {
                level.set(callee, next);
                queue.push(callee);
            } else if (next < level.get(callee)) {
                level.set(callee, next);
            }
        });
    }
    names.forEach((name) => {
        if (!level.has(name)) {
            level.set(name, 0);
        }
    });

    const buckets = new Map();
    names.forEach((name) => {
        const depth = level.get(name);
        if (!buckets.has(depth)) {
            buckets.set(depth, []);
        }
        buckets.get(depth).push(name);
    });
    Array.from(buckets.values()).forEach((row) => row.sort());

    const nodeH = 28;
    const padX = 16;
    const padY = 18;
    const colGap = 56;
    const rowGap = 14;
    const boxes = new Map();
    let maxRight = padX;
    let maxBottom = padY;

    Array.from(buckets.keys()).sort((a, b) => a - b).forEach((depth) => {
        const row = buckets.get(depth);
        let x = padX;
        const y = padY + depth * (nodeH + colGap);
        row.forEach((name) => {
            const width = Math.max(56, name.length * 7.4 + 20);
            boxes.set(name, { x, y, w: width, h: nodeH });
            x += width + rowGap;
        });
        maxRight = Math.max(maxRight, x);
        maxBottom = Math.max(maxBottom, y + nodeH);
    });

    return {
        names,
        boxes,
        edges: edges || [],
        width: Math.max(240, maxRight + padX),
        height: Math.max(120, maxBottom + padY)
    };
}

function renderCallGraphSvg(edges) {
    const layout = layoutCallGraph(edges);
    const svg = svgEl('svg', {
        xmlns: SVG_NS,
        width: String(layout.width),
        height: String(layout.height),
        viewBox: `0 0 ${layout.width} ${layout.height}`
    });

    const defs = svgEl('defs', {});
    const marker = svgEl('marker', {
        id: 'cg-arrow',
        viewBox: '0 0 10 10',
        refX: '9',
        refY: '5',
        markerWidth: '7',
        markerHeight: '7',
        orient: 'auto-start-reverse'
    });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#89d185' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    layout.edges.forEach((edge) => {
        const from = layout.boxes.get(edge[0]);
        const to = layout.boxes.get(edge[1]);
        if (!from || !to) {
            return;
        }
        const x1 = from.x + from.w / 2;
        const y1 = from.y + from.h;
        const x2 = to.x + to.w / 2;
        const y2 = to.y;
        const midY = (y1 + y2) / 2;
        const d = y2 >= y1
            ? `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1} ${y1 + 24}, ${x2} ${y2 - 24}, ${x2} ${y2}`;
        svg.appendChild(svgEl('path', {
            d,
            fill: 'none',
            stroke: '#89d185',
            'stroke-width': '1.6',
            'marker-end': 'url(#cg-arrow)'
        }));
    });

    layout.names.forEach((name) => {
        const box = layout.boxes.get(name);
        const g = svgEl('g', {});
        g.appendChild(svgEl('rect', {
            x: String(box.x),
            y: String(box.y),
            width: String(box.w),
            height: String(box.h),
            rx: '6',
            ry: '6',
            fill: '#0e639c',
            stroke: '#75beff'
        }));
        const label = svgEl('text', {
            x: String(box.x + box.w / 2),
            y: String(box.y + box.h / 2 + 4),
            'text-anchor': 'middle',
            fill: '#ffffff',
            'font-size': '12',
            'font-family': 'Menlo, Consolas, monospace'
        });
        label.textContent = name;
        g.appendChild(label);
        svg.appendChild(g);
    });
    return svg;
}

function currentCallGraphSvg() {
    return document.querySelector('#callgraph-canvas svg');
}

function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleDownloadSvg() {
    const svg = currentCallGraphSvg();
    if (!svg) {
        showStatus('No call graph to save.', true);
        return;
    }
    const payload = new XMLSerializer().serializeToString(svg);
    downloadBlob(
        `${lastCallGraphName}.callgraph.svg`,
        new Blob([payload], { type: 'image/svg+xml;charset=utf-8' })
    );
    showStatus(`Saved ${lastCallGraphName}.callgraph.svg`);
}

function handleDownloadPdf() {
    const svg = currentCallGraphSvg();
    if (!svg) {
        showStatus('No call graph to save.', true);
        return;
    }
    const clone = svg.cloneNode(true);
    const page = window.open('', '_blank');
    if (!page) {
        showStatus('Pop-up blocked. Allow pop-ups to save PDF.', true);
        return;
    }
    page.document.open();
    page.document.write('<!DOCTYPE html><html><head><title>' + lastCallGraphName + ' call graph</title><style>@page { size: landscape; margin: 16mm; } body { margin: 0; background: #1e1e1e; } svg { display: block; margin: 24px auto; }</style></head><body>' + new XMLSerializer().serializeToString(clone) + '</body></html>');
    page.document.close();
    page.focus();
    page.onload = () => { page.print(); };
    setTimeout(() => page.print(), 250);
    showStatus('Use the print dialog to save as PDF');
}

function showCallGraphPanel(graph) {
    const canvasEl = document.getElementById('callgraph-canvas');
    const emptyEl = document.getElementById('callgraph-empty');
    const titleEl = document.getElementById('callgraph-title');
    const filename = currentFileName || 'file';
    lastCallGraphName = filename.replace(/\.py$/i, '') || 'callgraph';
    titleEl.textContent = `Call graph — ${filename}`;
    canvasEl.innerHTML = '';

    const edges = graph.edges || [];
    const hasGraph = edges.length > 0;
    emptyEl.hidden = hasGraph;
    document.getElementById('callgraph-svg').disabled = !hasGraph;
    document.getElementById('callgraph-pdf').disabled = !hasGraph;
    if (hasGraph) {
        canvasEl.appendChild(renderCallGraphSvg(edges));
    }
    document.getElementById('callgraph-panel').hidden = false;
}


/**
 * Jump the Monaco cursor to a 1-based line number.
 */
function goToLine(lineNumber) {
    if (!editor) {
        return;
    }
    const line = Math.max(1, Number(lineNumber) || 1);
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
}

/**
 * Reject names the backend would also reject (path traversal / separators).
 */
function isUnsafeFilename(filename) {
    return !filename || filename === '.' || filename === '..'
        || filename.includes('..') || filename.includes('/') || filename.includes('\\');
}

/**
 * Parse FastAPI-style {"detail": "..."} error bodies into a readable string.
 */
function errorDetail(data, fallback) {
    if (!data) {
        return fallback;
    }
    if (typeof data.detail === 'string') {
        return data.detail;
    }
    return fallback;
}

/**
 * Call a REST endpoint and return parsed JSON. Throws on non-2xx responses.
 */
async function apiRequest(path, options = {}) {
    let response;
    try {
        response = await fetch(`${API_BASE}${path}`, {
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            ...options
        });
    } catch (error) {
        throw new Error(`Cannot reach ${API_BASE}. Is the backend running?`);
    }

    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            data = null;
        }
    }

    if (!response.ok) {
        throw new Error(errorDetail(data, `HTTP ${response.status}`));
    }
    return data;
}

function listFilesFromApi() {
    return apiRequest('/files');
}

function getFileFromApi(filename) {
    return apiRequest(`/file/${encodeURIComponent(filename)}`);
}

function createFileOnApi(filename, content) {
    return apiRequest(`/create/${encodeURIComponent(filename)}`, {
        method: 'POST',
        body: JSON.stringify({ content })
    });
}

function updateFileOnApi(filename, content) {
    return apiRequest(`/update/${encodeURIComponent(filename)}`, {
        method: 'POST',
        body: JSON.stringify({ content })
    });
}

function deleteFileOnApi(filename) {
    return apiRequest(`/file/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
    });
}

function getCallGraphFromApi(filename) {
    return apiRequest(`/callgraph/${encodeURIComponent(filename)}`);
}

async function handleCallGraph() {
    if (!isPythonFile(currentFileName)) {
        showStatus('Open a Python file to build a call graph.', true);
        return;
    }
    const button = document.getElementById('callgraph-btn');
    button.disabled = true;
    try {
        showStatus('Building call graph…');
        const graph = await getCallGraphFromApi(currentFileName);
        showCallGraphPanel(graph);
        const edgeCount = (graph.edges || []).length;
        showStatus(`Call graph ready (${edgeCount} edges)`);
    } catch (error) {
        console.error(error);
        showStatus(error.message, true);
    } finally {
        updateActionButtons();
    }
}


/**
 * Show a short-lived status line in the toolbar.
 */
function showStatus(message, isError) {
    const el = document.getElementById('status-message');
    el.textContent = message;
    el.classList.toggle('error', Boolean(isError));
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
        el.textContent = '';
        el.classList.remove('error');
    }, 4000);
}

/**
 * Enable Save / Delete only when a file is open.
 */
function updateActionButtons() {
    const hasFile = Boolean(currentFileName);
    document.getElementById('save-btn').disabled = !hasFile;
    document.getElementById('delete-btn').disabled = !hasFile;
    document.getElementById('callgraph-btn').disabled = !isPythonFile(currentFileName);
}

/**
 * Inject the AMD loader script and resolve once Monaco is ready.
 */
function loadMonaco() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${MONACO_BASE_URL}/vs/loader.js`;
        script.async = true;

        script.onload = () => {
            // Point the AMD loader at the same CDN that served loader.js.
            window.require.config({
                paths: { vs: `${MONACO_BASE_URL}/vs` }
            });

            // Workers cannot be loaded from a file:// page, so serve them via a blob URL.
            window.MonacoEnvironment = {
                getWorkerUrl() {
                    const workerSource = `
                        self.MonacoEnvironment = { baseUrl: '${MONACO_BASE_URL}/' };
                        importScripts('${MONACO_BASE_URL}/vs/base/worker/workerMain.js');
                    `;
                    return URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
                }
            };

            window.require(['vs/editor/editor.main'], () => {
                resolve(window.monaco);
            }, (err) => {
                reject(err || new Error('Monaco AMD modules failed to load.'));
            });
        };

        script.onerror = () => {
            reject(new Error('Failed to download Monaco Editor from the CDN.'));
        };

        document.head.appendChild(script);
    });
}

/**
 * Replace the editor with a visible error message when CDN loading fails.
 */
function showEditorFallback(error) {
    const editorEl = document.getElementById('editor');
    const fallbackEl = document.getElementById('editor-fallback');
    const labelEl = document.getElementById('editor-label');

    editorEl.hidden = true;
    labelEl.textContent = 'Editor unavailable';
    fallbackEl.hidden = false;
    fallbackEl.textContent =
        'Monaco Editor failed to load. Check your network connection and refresh the page. ' +
        (error && error.message ? error.message : '');
}

/**
 * Render the current FileInfo list into the sidebar.
 */
function renderFileList() {
    const listEl = document.getElementById('file-list');
    listEl.innerHTML = '';

    if (files.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'file-list-empty';
        empty.textContent = 'No files yet. Create one with the form above.';
        listEl.appendChild(empty);
        return;
    }

    files.forEach((file) => {
        const item = document.createElement('li');
        const button = document.createElement('button');

        button.type = 'button';
        button.className = 'file-item';
        button.textContent = file.name;
        button.dataset.fileName = file.name;
        button.title = `${file.size} bytes`;
        button.classList.toggle('dirty', fileHasDraft(file.name));
        button.addEventListener('click', () => openFile(file.name));

        item.appendChild(button);
        listEl.appendChild(item);
    });

    setActiveFile(currentFileName);
}

/**
 * Highlight the active file in the sidebar.
 */
function setActiveFile(fileName) {
    document.querySelectorAll('.file-item').forEach((button) => {
        button.classList.toggle('active', button.dataset.fileName === fileName);
    });
}

/**
 * Update the tab label and sidebar dots for unsaved local drafts.
 */
function updateDirtyIndicators() {
    const labelEl = document.getElementById('editor-label');
    if (!currentFileName) {
        labelEl.textContent = 'No file selected';
    } else {
        labelEl.textContent = isDirty() ? `${currentFileName} •` : currentFileName;
    }

    document.querySelectorAll('.file-item').forEach((button) => {
        button.classList.toggle('dirty', fileHasDraft(button.dataset.fileName));
    });
}

/**
 * Replace the current Monaco model with the given text and language.
 */
function setEditorContent(fileName, content, languageOverride) {
    if (!editor) {
        return;
    }

    const language = languageOverride || detectLanguage(fileName);
    applyingEditorContent = true;
    const model = monaco.editor.createModel(content, language);
    const previousModel = editor.getModel();
    editor.setModel(model);
    applyingEditorContent = false;

    if (previousModel) {
        previousModel.dispose();
    }
}

/**
 * Clear the editor when the workspace has no selected file.
 */
function clearEditor() {
    stashCurrentDraft();
    currentFileName = null;
    if (editor) {
        setEditorContent('untitled.txt', '', 'plaintext');
    }
    updateDirtyIndicators();
    setActiveFile(null);
    updateActionButtons();
}

/**
 * Fetch GET /files and redraw the sidebar. Optionally open a preferred file.
 * Local drafts are restored unless the caller already discarded them.
 */
async function refreshFileList(preferredName, options = {}) {
    if (!options.skipStash) {
        stashCurrentDraft();
    }
    files = await listFilesFromApi();
    renderFileList();

    const names = files.map((file) => file.name);
    const toOpen = names.includes(preferredName) ? preferredName : names[0];
    if (toOpen) {
        // Allow openFile to run even when the same file is already selected.
        currentFileName = null;
        await openFile(toOpen);
    } else {
        currentFileName = null;
        if (editor) {
            setEditorContent('untitled.txt', '', 'plaintext');
        }
        updateDirtyIndicators();
        setActiveFile(null);
        updateActionButtons();
    }
}

/**
 * Show a file in Monaco. Unsaved text is restored from the local draft map
 * when present; otherwise the server copy is loaded. Never prompts to save.
 * options.lineNumber (1-based) jumps the cursor after the file is shown.
 */
async function openFile(fileName, options) {
    options = options || {};
    const lineNumber = options.lineNumber;
    if (!editor) {
        return false;
    }

    if (fileName !== currentFileName) {
        stashCurrentDraft();

        currentFileName = fileName;
        document.getElementById('editor-label').textContent = fileName;
        setActiveFile(fileName);
        updateActionButtons();

        try {
            const payload = await getFileFromApi(fileName);
            if (currentFileName !== fileName) {
                return false;
            }
            serverContent.set(fileName, payload.content);
            const text = drafts.has(fileName) ? drafts.get(fileName) : payload.content;
            setEditorContent(fileName, text);
            updateDirtyIndicators();
        } catch (error) {
            console.error(error);
            if (currentFileName !== fileName) {
                return false;
            }
            serverContent.set(fileName, '');
            const fallback = drafts.has(fileName)
                ? drafts.get(fileName)
                : `Failed to load ${fileName} from the API.\n${error.message}`;
            setEditorContent(fileName, fallback, drafts.has(fileName) ? null : 'plaintext');
            updateDirtyIndicators();
            showStatus(error.message, true);
            return false;
        }
    }

    if (lineNumber) {
        goToLine(lineNumber);
    }
    return true;
}

async function handleCreate(event) {
    event.preventDefault();
    const input = document.getElementById('new-filename');
    const filename = input.value.trim();

    if (isUnsafeFilename(filename)) {
        showStatus('Invalid filename. Do not use .., / or \\.', true);
        return;
    }

    try {
        await createFileOnApi(filename, '');
        input.value = '';
        showStatus(`Created ${filename}`);
        await refreshFileList(filename);
    } catch (error) {
        console.error(error);
        showStatus(error.message, true);
    }
}

/**
 * POST /update/{filename} with the current editor text.
 */
async function handleSave() {
    if (!currentFileName || !editor) {
        return;
    }

    const content = editor.getValue();
    try {
        await updateFileOnApi(currentFileName, content);
        serverContent.set(currentFileName, content);
        drafts.delete(currentFileName);
        updateDirtyIndicators();
        showStatus(`Saved ${currentFileName}`);
        files = await listFilesFromApi();
        renderFileList();
    } catch (error) {
        console.error(error);
        showStatus(error.message, true);
    }
}

/**
 * DELETE /file/{filename} for the current file, then refresh the list.
 */
async function handleDelete() {
    if (!currentFileName) {
        return;
    }

    const confirmed = window.confirm(`Delete ${currentFileName}?`);
    if (!confirmed) {
        return;
    }

    const deletedName = currentFileName;
    try {
        await deleteFileOnApi(deletedName);
        drafts.delete(deletedName);
        serverContent.delete(deletedName);
        showStatus(`Deleted ${deletedName}`);
        currentFileName = null;
        await refreshFileList();
    } catch (error) {
        console.error(error);
        showStatus(error.message, true);
    }
}

/**
 * GET /files again. If there are local drafts, ask before throwing them away.
 */
async function handleRefresh() {
    const proceed = await confirmDiscardUnsaved();
    if (!proceed) {
        return;
    }

    drafts.clear();
    try {
        const keepName = currentFileName;
        await refreshFileList(keepName, { skipStash: true });
        showStatus('File list refreshed');
    } catch (error) {
        console.error(error);
        files = [];
        renderFileList();
        showStatus(error.message, true);
    }
}

/**
 * Reload the browser page after the same unsaved-file confirmation.
 */
async function handlePageReload(event) {
    stashCurrentDraft();
    if (drafts.size === 0) {
        return;
    }
    event.preventDefault();
    const proceed = await confirmDiscardUnsaved();
    if (proceed) {
        drafts.clear();
        window.location.reload();
    }
}

/**
 * Create the Monaco instance and keep it sized to its container.
 */
function createEditor() {
    const container = document.getElementById('editor');

    editor = monaco.editor.create(container, {
        value: '',
        language: 'plaintext',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        scrollBeyondLastLine: false,
        readOnly: false
    });

    editor.onDidChangeModelContent(() => {
        if (!applyingEditorContent) {
            stashCurrentDraft();
            updateDirtyIndicators();
        }
    });

    window.addEventListener('resize', () => {
        if (editor) {
            editor.layout();
        }
    });
}

/**
 * Wire toolbar and sidebar actions to the REST endpoints.
 */
function bindUi() {
    document.getElementById('refresh-btn').addEventListener('click', handleRefresh);
    document.getElementById('save-btn').addEventListener('click', handleSave);
    document.getElementById('delete-btn').addEventListener('click', handleDelete);
    document.getElementById('create-form').addEventListener('submit', handleCreate);
    document.getElementById('callgraph-btn').addEventListener('click', handleCallGraph);
    document.getElementById('callgraph-svg').addEventListener('click', handleDownloadSvg);
    document.getElementById('callgraph-pdf').addEventListener('click', handleDownloadPdf);
    document.getElementById('callgraph-close').addEventListener('click', closeCallGraphPanel);
    document.getElementById('discard-cancel').addEventListener('click', () => closeDiscardModal(false));
    document.getElementById('discard-confirm').addEventListener('click', () => closeDiscardModal(true));
    document.getElementById('discard-overlay').addEventListener('click', (event) => {
        if (event.target.id === 'discard-overlay') {
            closeDiscardModal(false);
        }
    });

    window.addEventListener('keydown', (event) => {
        const overlayOpen = !document.getElementById('discard-overlay').hidden;
        if (event.key === 'Escape' && overlayOpen) {
            event.preventDefault();
            closeDiscardModal(false);
            return;
        }
        const isReload = event.key === 'F5'
            || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r');
        if (isReload && !overlayOpen) {
            handlePageReload(event);
        }
    });

    // Browser reload / close cannot show a custom file list; this is the fallback.
    window.addEventListener('beforeunload', (event) => {
        stashCurrentDraft();
        if (drafts.size > 0) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    updateActionButtons();
}

/**
 * Boot the page: bind UI, load Monaco, then fetch the file list from the API.
 */
async function init() {
    bindUi();

    try {
        await loadMonaco();
        createEditor();
    } catch (error) {
        console.error(error);
        showEditorFallback(error);
        return;
    }

    try {
        await refreshFileList();
    } catch (error) {
        console.error(error);
        clearEditor();
        renderFileList();
        showStatus(error.message, true);
    }
}

init();
