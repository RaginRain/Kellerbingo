import Tesseract from 'tesseract.js';
import { ScanResult, AnalysisResponse, ValidationResult } from "../types";

// --- Types ---

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface DetectedWord {
    text: string;
    bbox: Rect;
    confidence: number;
}

// --- Singleton Worker ---
let workerInstance: any | null = null;

const getWorker = async (): Promise<any> => {
    if (!workerInstance) {
        workerInstance = await Tesseract.createWorker('eng', 1, {
            logger: m => console.debug(m)
        });
        
        await workerInstance.setParameters({
            tessedit_char_whitelist: '0123456789/ abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-|\\:',
            tessedit_pageseg_mode: '6', // PSM_SINGLE_BLOCK
        });
    }
    return workerInstance;
};

// --- Image Processing ---

const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
};

const createBinaryCanvas = (img: HTMLImageElement): { ctx: CanvasRenderingContext2D, width: number, height: number, binaryData: Uint8Array } => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas failed");

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Adaptive Thresholding
    let sumR = 0;
    let count = 0;
    
    // Sample entire image
    const step = 20;
    for (let y = 0; y < canvas.height; y += step) {
        for (let x = 0; x < canvas.width; x += step) {
            const i = (y * canvas.width + x) * 4;
            sumR += data[i];
            count++;
        }
    }

    const avgR = count > 0 ? sumR / count : 128;
    const threshold = avgR * 0.85; 
    
    const binaryData = new Uint8Array(canvas.width * canvas.height);
    const buf32 = new Uint32Array(imageData.data.buffer);
    const black = 0xFF000000; 
    const white = 0xFFFFFFFF; 

    for (let i = 0; i < canvas.width * canvas.height; i++) {
        const r = data[i * 4];
        const isDark = r < threshold;
        buf32[i] = isDark ? black : white;
        binaryData[i] = isDark ? 0 : 1; // 0 = Ink, 1 = Paper
    }

    ctx.putImageData(imageData, 0, 0);
    return { ctx, width: canvas.width, height: canvas.height, binaryData };
};

// --- Morphological Operations (Cleaning) ---

const erodeCanvas = (ctx: CanvasRenderingContext2D, width: number, height: number, protectedRects: Rect[], iterations: number = 1) => {
    let currentImageData = ctx.getImageData(0, 0, width, height);
    
    for (let iter = 0; iter < iterations; iter++) {
        const inputData = new Uint32Array(currentImageData.data.buffer);
        const outputImageData = ctx.createImageData(width, height);
        const outputData = new Uint32Array(outputImageData.data.buffer);
        outputData.fill(0xFFFFFFFF);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                // Check if protected
                let isProtected = false;
                for (const r of protectedRects) {
                    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
                        isProtected = true;
                        break;
                    }
                }
                const i = y * width + x;
                if (isProtected) {
                    outputData[i] = inputData[i]; 
                    continue;
                }

                if (inputData[i] === 0xFF000000) { 
                    if (iter === 0) {
                        // Pass 1: Standard Erosion
                        let hasWhiteNeighbor = false;
                        if (inputData[i - 1] === 0xFFFFFFFF || 
                            inputData[i + 1] === 0xFFFFFFFF ||
                            inputData[i - width] === 0xFFFFFFFF ||
                            inputData[i + width] === 0xFFFFFFFF) {
                            hasWhiteNeighbor = true;
                        }
                        if (!hasWhiteNeighbor) {
                            outputData[i] = 0xFF000000; 
                        }
                    } else {
                        // Pass 2: Smart Despeckle (Threshold 3)
                        let neighbors = 0;
                        if (inputData[i - 1] === 0xFF000000) neighbors++;
                        if (inputData[i + 1] === 0xFF000000) neighbors++;
                        if (inputData[i - width] === 0xFF000000) neighbors++;
                        if (inputData[i + width] === 0xFF000000) neighbors++;
                        
                        if (inputData[i - width - 1] === 0xFF000000) neighbors++;
                        if (inputData[i - width + 1] === 0xFF000000) neighbors++;
                        if (inputData[i + width - 1] === 0xFF000000) neighbors++;
                        if (inputData[i + width + 1] === 0xFF000000) neighbors++;

                        if (neighbors >= 3) {
                            outputData[i] = 0xFF000000;
                        }
                    }
                }
            }
        }
        currentImageData = outputImageData;
    }
    ctx.putImageData(currentImageData, 0, 0);
};

// --- White Square Detection ---

const findWhiteComponents = (binaryData: Uint8Array, width: number, height: number): Rect[] => {
    const targetWidth = 300;
    const scale = targetWidth / width; 
    const sW = Math.floor(width * scale);
    const sH = Math.floor(height * scale);
    
    const visited = new Uint8Array(sW * sH);
    const components: Rect[] = [];

    const idx = (x: number, y: number) => y * sW + x;
    const originalIdx = (x: number, y: number) => {
        const ox = Math.floor(x / scale);
        const oy = Math.floor(y / scale);
        return oy * width + ox;
    };

    for (let y = 0; y < sH; y++) {
        for (let x = 0; x < sW; x++) {
            if (visited[idx(x, y)]) continue;

            const oIdx = originalIdx(x, y);
            if (binaryData[oIdx] === 0) { 
                visited[idx(x, y)] = 1;
                continue;
            }

            let minX = x, maxX = x, minY = y, maxY = y;
            const queue = [x, y];
            visited[idx(x, y)] = 1;

            while (queue.length > 0) {
                const cy = queue.pop()!;
                const cx = queue.pop()!;

                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;

                const neighbors = [
                    cx + 1, cy,
                    cx - 1, cy,
                    cx, cy + 1,
                    cx, cy - 1
                ];

                for (let i = 0; i < neighbors.length; i += 2) {
                    const nx = neighbors[i];
                    const ny = neighbors[i+1];

                    if (nx >= 0 && nx < sW && ny >= 0 && ny < sH) {
                        const nIdx = idx(nx, ny);
                        if (visited[nIdx] === 0) {
                            const onIdx = originalIdx(nx, ny);
                            if (binaryData[onIdx] === 1) { 
                                visited[nIdx] = 1;
                                queue.push(nx, ny);
                            }
                        }
                    }
                }
            }

            const w = maxX - minX + 1;
            const h = maxY - minY + 1;
            const ratio = w / h;
            const isSquareish = ratio > 0.6 && ratio < 2.5;
            const isBigEnough = w > (sW * 0.03) && h > (sH * 0.03); 
            const isNotTooBig = w < (sW * 0.25); 

            if (isSquareish && isBigEnough && isNotTooBig) {
                components.push({
                    x: Math.floor(minX / scale),
                    y: Math.floor(minY / scale),
                    w: Math.floor(w / scale),
                    h: Math.floor(h / scale)
                });
            }
        }
    }
    return components;
};

// --- Smart Grid Reconstruction ---

const interpolateGrid = (rows: { y: number, h: number, cells: Rect[] }[]): { cells: Rect[], rowY: number, rowH: number }[] => {
    let totalW = 0, totalH = 0, count = 0;
    rows.forEach(r => r.cells.forEach(c => { totalW += c.w; totalH += c.h; count++; }));
    const avgW = count > 0 ? totalW / count : 50;
    const avgH = count > 0 ? totalH / count : 50;

    const allCells = rows.flatMap(r => r.cells);
    allCells.sort((a,b) => a.x - b.x);
    
    const columnsX: number[] = [];
    if (allCells.length > 0) {
        let currentClusterX = allCells[0].x;
        let clusterCount = 1;
        for (let i = 1; i < allCells.length; i++) {
            if (allCells[i].x - currentClusterX < avgW * 0.6) {
                currentClusterX = (currentClusterX * clusterCount + allCells[i].x) / (clusterCount + 1);
                clusterCount++;
            } else {
                columnsX.push(currentClusterX);
                currentClusterX = allCells[i].x;
                clusterCount = 1;
            }
        }
        columnsX.push(currentClusterX);
    }

    while (columnsX.length < 6 && columnsX.length > 0) {
        const lastX = columnsX[columnsX.length - 1];
        columnsX.push(lastX + avgW * 1.05); 
    }
    columnsX.sort((a,b) => a - b);
    
    return rows.map(row => {
        const finalCells: Rect[] = [];
        for (let i = 0; i < 6; i++) { 
            const colX = columnsX[i] || (i * avgW * 1.1); 
            const existing = row.cells.find(c => Math.abs(c.x - colX) < avgW * 0.5);
            if (existing) {
                finalCells.push(existing);
            } else {
                finalCells.push({
                    x: Math.floor(colX),
                    y: Math.floor(row.y),
                    w: Math.floor(avgW),
                    h: Math.floor(avgH) 
                });
            }
        }
        return { cells: finalCells, rowY: row.y, rowH: row.h };
    });
};

// --- Content Verification ---

const hasInk = (ctx: CanvasRenderingContext2D, rect: Rect): boolean => {
    const imgData = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    const data = new Uint32Array(imgData.data.buffer);
    let denseBlackPixels = 0;
    const totalPixels = rect.w * rect.h;
    const width = rect.w;
    
    for (let y = 1; y < rect.h - 1; y++) {
        for (let x = 1; x < rect.w - 1; x++) {
            const i = y * width + x;
            
            if (data[i] === 0xFF000000) {
                let neighborCount = 0;
                
                if (data[i - 1] === 0xFF000000) neighborCount++;
                if (data[i + 1] === 0xFF000000) neighborCount++;
                if (data[i - width] === 0xFF000000) neighborCount++;
                if (data[i + width] === 0xFF000000) neighborCount++;
                if (data[i - width - 1] === 0xFF000000) neighborCount++;
                if (data[i - width + 1] === 0xFF000000) neighborCount++;
                if (data[i + width - 1] === 0xFF000000) neighborCount++;
                if (data[i + width + 1] === 0xFF000000) neighborCount++;

                // Strict ink detection (6 neighbors)
                if (neighborCount >= 6) {
                    denseBlackPixels++;
                }
            }
        }
    }
    
    // Density threshold > 1%
    return (denseBlackPixels / totalPixels) > 0.01; 
};

// --- Composite Image Generation ---
interface MappedCell {
    ticketIndex: number;
    rowIndex: number;
    colIndex: number;
    spriteRect: Rect;
    originalRect: Rect;
    type: 'number' | 'id';
}

const generateCompositeCanvas = (
    binaryCtx: CanvasRenderingContext2D, 
    tickets: { rows: { y: number, h: number, cells: Rect[] }[] }[]
): { compositeCanvas: HTMLCanvasElement, map: MappedCell[] } => {
    
    // INCREASED RESOLUTION FOR BETTER OCR
    const cellSize = 160; 
    // Massive padding to prevent Tesseract from merging adjacent numbers
    const padding = 400; 
    
    const ticketHeight = 3 * (cellSize + padding) + padding;
    // Calculate canvas size dynamically to allow for wide ID fields
    let maxRowWidth = 6 * (cellSize + padding) + padding * 2; 
    
    // Pass 1: Measure required width for ID fields to preserve aspect ratio
    tickets.forEach((ticket) => {
        const lastRow = interpolateGrid(ticket.rows)[2];
        const lastCell = lastRow.cells[5];
        if (lastCell) {
            // Refined Search Area for ID:
            const searchW = lastCell.w * 1.8; // Reduced width (cropped from right)
            const searchH = lastCell.h;
            
            // w_target = h_target * (w_src / h_src)
            const targetIDWidth = Math.floor(cellSize * (searchW / searchH));
            const rowWidthWithID = 6 * (cellSize + padding) + targetIDWidth + padding * 3;
            if (rowWidthWithID > maxRowWidth) maxRowWidth = rowWidthWithID;
        }
    });

    const canvasWidth = maxRowWidth;
    const canvasHeight = tickets.length * ticketHeight;
    
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = Math.max(canvasWidth, 1);
    compositeCanvas.height = Math.max(canvasHeight, 1);
    const ctx = compositeCanvas.getContext('2d');
    if (!ctx) throw new Error("Composite Canvas failed");

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);

    const map: MappedCell[] = [];
    const protectedRects: Rect[] = []; 

    tickets.forEach((ticket, tIdx) => {
        const interpolatedRows = interpolateGrid(ticket.rows);
        const startY = tIdx * ticketHeight + padding;

        for (let r = 0; r < 3; r++) {
            const row = interpolatedRows[r];
            const rowY = startY + r * (cellSize + padding);

            for (let c = 0; c < 6; c++) {
                const cell = row.cells[c];
                const spriteRect = {
                    x: padding + c * (cellSize + padding),
                    y: rowY,
                    w: cellSize,
                    h: cellSize
                };

                // Crop 32% margin for numbers (Safe center focus)
                const cropMarginX = cell.w * 0.32;
                const cropMarginY = cell.h * 0.32;
                
                const srcX = Math.floor(cell.x + cropMarginX);
                const srcY = Math.floor(cell.y + cropMarginY);
                const srcW = Math.floor(cell.w - cropMarginX * 2);
                const srcH = Math.floor(cell.h - cropMarginY * 2);

                if (hasInk(binaryCtx, {x: srcX, y: srcY, w: srcW, h: srcH})) {
                    try {
                        ctx.drawImage(
                            binaryCtx.canvas,
                            srcX, srcY, srcW, srcH,
                            spriteRect.x, spriteRect.y, spriteRect.w, spriteRect.h
                        );

                        map.push({
                            ticketIndex: tIdx,
                            rowIndex: r,
                            colIndex: c,
                            spriteRect,
                            originalRect: cell,
                            type: 'number'
                        });
                    } catch (e) { }
                }
            }
        }

        const lastRow = interpolatedRows[2];
        const lastCell = lastRow.cells[5];
        if (lastCell) {
            // Smart offset: Skip 30% of width to avoid left grid line and start of "Schein"
            const searchX = lastCell.x + lastCell.w + (lastCell.w * 0.30); 
            const searchY = lastCell.y;
            const searchW = lastCell.w * 1.8; // Reduced width (Cropped from right)
            const searchH = lastCell.h;
            
            // Clamp to image bounds
            const safeX = Math.min(searchX, binaryCtx.canvas.width - 1);
            const safeY = Math.min(searchY, binaryCtx.canvas.height - 1);
            const safeW = Math.min(searchW, binaryCtx.canvas.width - safeX);
            const safeH = Math.min(searchH, binaryCtx.canvas.height - safeY);

            // Calculate undistorted target width
            const ratio = (safeH > 0) ? safeW / safeH : 3;
            const targetIDWidth = Math.floor(cellSize * ratio);

            const spriteRect = {
                x: padding + 6 * (cellSize + padding), 
                y: startY + 2 * (cellSize + padding), 
                w: targetIDWidth,
                h: cellSize 
            };

            // Crop 20% margin for ID (Vertical) - Remove lines top/bottom
            const cropMarginY = safeH * 0.20; 

            if (safeW > 10 && safeH > 10) {
                try {
                    ctx.drawImage(
                        binaryCtx.canvas,
                        safeX, safeY + cropMarginY, safeW, safeH - cropMarginY * 2,
                        spriteRect.x, spriteRect.y, spriteRect.w, spriteRect.h
                    );

                    map.push({
                        ticketIndex: tIdx,
                        rowIndex: 2,
                        colIndex: 6, 
                        spriteRect,
                        originalRect: { x: safeX, y: safeY, w: safeW, h: safeH },
                        type: 'id'
                    });
                    protectedRects.push(spriteRect);
                } catch (e) { }
            }
        }
    });
    
    // 2 Iterations: 1 Standard, 1 Smart Despeckle (Threshold 3)
    erodeCanvas(ctx, compositeCanvas.width, compositeCanvas.height, protectedRects, 2);

    return { compositeCanvas, map };
};

// --- Detection Logic Shared by Validate & Analyze ---

const detectTicketsInImage = (binaryCtx: CanvasRenderingContext2D, width: number, height: number, binaryData: Uint8Array) => {
    const rawComponents = findWhiteComponents(binaryData, width, height);
    rawComponents.sort((a, b) => a.y - b.y);

    const rows: { y: number, h: number, cells: Rect[] }[] = [];
    for (const comp of rawComponents) {
        const matchRow = rows.find(r => {
            const centerY = comp.y + comp.h / 2;
            const rowCenterY = r.y + r.h / 2;
            return Math.abs(centerY - rowCenterY) < (r.h * 0.5); 
        });
        if (matchRow) {
            matchRow.cells.push(comp);
        } else {
            rows.push({ y: comp.y, h: comp.h, cells: [comp] });
        }
    }
    rows.forEach(r => r.cells.sort((a,b) => a.x - b.x));

    const validRows = rows.filter(r => r.cells.length >= 1); 
    validRows.sort((a, b) => a.y - b.y);

    const ticketsRaw: { rows: typeof validRows }[] = [];
    let currentTicketRows: typeof validRows = [];
    
    for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        if (currentTicketRows.length === 0) {
            currentTicketRows.push(row);
        } else {
            const prev = currentTicketRows[currentTicketRows.length - 1];
            const dist = row.y - (prev.y + prev.h);
            
            // Tightened threshold: 0.2x height to detect touching tickets
            if (dist < row.h * 0.2) {
                currentTicketRows.push(row);
            } else {
                // If we accumulated a multiple of 3 rows, assume they are multiple tickets touching
                const chunks = Math.floor(currentTicketRows.length / 3);
                for(let k=0; k<chunks; k++) {
                    ticketsRaw.push({ rows: currentTicketRows.slice(k*3, (k+1)*3) });
                }
                currentTicketRows = [row];
            }
        }
    }
    // Final flush
    const chunks = Math.floor(currentTicketRows.length / 3);
    for(let k=0; k<chunks; k++) {
        ticketsRaw.push({ rows: currentTicketRows.slice(k*3, (k+1)*3) });
    }
    
    return ticketsRaw;
};

// --- Fast Validation (Pre-Check) ---

export const validateTicketImage = async (imageSrc: string): Promise<ValidationResult> => {
    const img = await loadImage(imageSrc);
    // Reuse binarization logic but don't need the heavy processing context
    const { ctx, width, height, binaryData } = createBinaryCanvas(img);
    
    const detectedTickets = detectTicketsInImage(ctx, width, height, binaryData);
    
    // Draw validation overlay (Green boxes for detected tickets)
    ctx.lineWidth = 4;
    
    let isValid = false;
    let message = "Kein Schein erkannt. Bitte näher rangehen oder Licht verbessern.";
    
    if (detectedTickets.length > 0) {
        isValid = true;
        message = `${detectedTickets.length} Schein(e) erkannt.`;
        
        detectedTickets.forEach((ticket, idx) => {
            const firstRow = ticket.rows[0];
            const lastRow = ticket.rows[ticket.rows.length-1];
            
            // Find bounding box
            let minX = width, maxX = 0;
            ticket.rows.forEach(r => r.cells.forEach(c => {
                if(c.x < minX) minX = c.x;
                if(c.x + c.w > maxX) maxX = c.x + c.w;
            }));
            
            const minY = firstRow.y;
            const maxY = lastRow.y + lastRow.h;
            
            // 1. Draw fill
            ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
            ctx.fillRect(minX - 10, minY - 10, (maxX - minX) + 20, (maxY - minY) + 20);
            
            // 2. Draw border
            ctx.strokeStyle = '#00FF00';
            ctx.strokeRect(minX - 10, minY - 10, (maxX - minX) + 20, (maxY - minY) + 20);
            
            // 3. Draw Label
            ctx.font = 'bold 30px sans-serif';
            ctx.fillStyle = '#00FF00';
            // Draw background for text readability
            const text = `Schein #${idx+1}`;
            const textWidth = ctx.measureText(text).width;
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(minX - 10, minY - 45, textWidth + 20, 35);
            
            ctx.fillStyle = '#00FF00';
            ctx.fillText(text, minX, minY - 18);
        });
    } else {
        // Red overlay if bad
        ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
        ctx.fillRect(0,0, width, height);
    }
    
    return {
        isValid,
        message,
        ticketCount: detectedTickets.length,
        overlayImage: ctx.canvas.toDataURL('image/jpeg', 0.6)
    };
};

// --- Main Analysis ---

export const analyzeTicketImage = async (imageSrc: string): Promise<AnalysisResponse> => {
    const img = await loadImage(imageSrc);
    const { ctx, width, height, binaryData } = createBinaryCanvas(img);

    const ticketsRaw = detectTicketsInImage(ctx, width, height, binaryData);

    const { compositeCanvas, map } = generateCompositeCanvas(ctx, ticketsRaw);

    const worker = await getWorker();
    const timeoutPromise = new Promise<null>((_, r) => setTimeout(() => r(new Error("Timeout")), 60000));
    
    const ocrPromise = worker.recognize(compositeCanvas);
    let ocrResult: any;
    try {
        ocrResult = await Promise.race([ocrPromise, timeoutPromise]);
    } catch (e) {
        throw new Error("OCR Timeout");
    }
    
    const ocrWords: DetectedWord[] = ocrResult.data.words.map((w: any) => ({
        text: w.text.trim(),
        bbox: { x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 },
        confidence: w.confidence
    }));

    const finalResults: ScanResult[] = ticketsRaw.map(() => ({
        ticketId: `ID-${Math.floor(Math.random()*9999)}`,
        grid: Array(3).fill(null).map(() => Array(6).fill(0))
    }));

    // Group items by ticket and type to handle ID reconstruction properly
    ticketsRaw.forEach((_, tIdx) => {
        // 1. Process Numbers
        const numberItems = map.filter(m => m.ticketIndex === tIdx && m.type === 'number');
        numberItems.forEach(item => {
             const candidates = ocrWords.filter(w => {
                const centerX = w.bbox.x + w.bbox.w/2;
                const centerY = w.bbox.y + w.bbox.h/2;
                return centerX > item.spriteRect.x && centerX < (item.spriteRect.x + item.spriteRect.w) &&
                       centerY > item.spriteRect.y && centerY < (item.spriteRect.y + item.spriteRect.h);
            });
            
            if (candidates.length > 0) {
                candidates.sort((a,b) => b.confidence - a.confidence);
                const best = candidates[0];
                
                const rawText = best.text.trim();
                const textH = best.bbox.h;
                const cellH = item.spriteRect.h; 
                
                if (textH / cellH < 0.33) return;

                const alphaCount = (rawText.match(/[a-zA-Z]/g) || []).length;
                const digitCount = (rawText.match(/[0-9]/g) || []).length;
                const numberLikeAlpha = (rawText.match(/[IlOSBZAGT]/gi) || []).length;
                const badAlpha = alphaCount - numberLikeAlpha;

                if (badAlpha > digitCount && rawText.length > 1) {
                    return;
                }

                let txt = rawText.toUpperCase();
                txt = txt.replace(/l/g, '1').replace(/I/g, '1').replace(/O/g, '0')
                         .replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '7')
                         .replace(/A/g, '4').replace(/G/g, '6')
                         .replace(/T/g, '7');
                
                const clean = txt.replace(/[^0-9]/g, '');
                const num = parseInt(clean);
                if (!isNaN(num) && num > 0 && num < 100) {
                    finalResults[tIdx].grid[item.rowIndex][item.colIndex] = num;
                }
            }
        });

        // 2. Process ID (Collect ALL words in the ID box)
        const idMapItem = map.find(m => m.ticketIndex === tIdx && m.type === 'id');
        if (idMapItem) {
            const idWords = ocrWords.filter(w => {
                 const centerX = w.bbox.x + w.bbox.w/2;
                 const centerY = w.bbox.y + w.bbox.h/2;
                 return centerX > idMapItem.spriteRect.x && centerX < (idMapItem.spriteRect.x + idMapItem.spriteRect.w) &&
                        centerY > idMapItem.spriteRect.y && centerY < (idMapItem.spriteRect.y + idMapItem.spriteRect.h);
            });
            
            if (idWords.length > 0) {
                const fullText = idWords.map(w => w.text).join(' '); 
                
                // Aggressive cleanup: Removing potential alpha prefixes (Schein, Nr, etc)
                // Remove sequences of 2+ letters
                let processed = fullText.replace(/[A-Za-zäöüÄÖÜß]{2,}/g, '');
                
                // Normalize potential slash characters (| \ I l : .) to /
                processed = processed.replace(/[|\\I:.]/g, '/');

                // 3. Search for pattern: Number / Number
                const slashMatch = processed.match(/(\d{1,5})\s*\/\s*(\d{1,5})/);

                if (slashMatch) {
                     finalResults[tIdx].ticketId = `${slashMatch[1]}/${slashMatch[2]}`;
                } else {
                     // 4. Fallback: Clean non-alphanumeric except spaces, look for space separated numbers
                     // This handles "160 400" where slash is missing
                     const looseText = processed.replace(/[^0-9\s]/g, ' ').trim();
                     const parts = looseText.split(/\s+/).filter(s => s.length > 0);
                     
                     if (parts.length >= 2) {
                         // Take the last two distinct number groups (ID is usually at end)
                         const p1 = parts[parts.length - 2];
                         const p2 = parts[parts.length - 1];
                         finalResults[tIdx].ticketId = `${p1}/${p2}`;
                     }
                }
            }
        }
    });

    // Draw Debug Boxes on Composite Canvas after OCR
    const debugCtx = compositeCanvas.getContext('2d');
    if (debugCtx) {
        debugCtx.lineWidth = 2;
        debugCtx.strokeStyle = 'blue';
        ocrWords.forEach(w => {
            debugCtx.strokeRect(w.bbox.x, w.bbox.y, w.bbox.w, w.bbox.h);
        });
    }

    return {
        results: finalResults,
        debugDataUrl: compositeCanvas.toDataURL('image/jpeg', 0.8)
    };
};
