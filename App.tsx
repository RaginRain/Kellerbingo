import React, { useState, useCallback, useRef } from 'react';
import { BingoTicket, ValidationResult } from './types';
import { analyzeTicketImage, validateTicketImage } from './services/geminiService';
import { TicketCard } from './components/TicketCard';
import { NumberInput } from './components/NumberInput';

// Helper to resize and compress image before sending to API/OCR
const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const elem = document.createElement('canvas');
        // Limit width to 2000px - Higher quality for crossed-out numbers
        const maxWidth = 2000;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }

        elem.width = width;
        elem.height = height;
        const ctx = elem.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            resolve(elem.toDataURL('image/png')); // Use PNG for lossless text edges
        } else {
            reject(new Error("Canvas context failed"));
        }
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// Safe ID generator that works in non-secure contexts (HTTP)
const generateId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

// Types for Confirmation Modal
interface ConfirmationState {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
}

export default function App() {
  const [tickets, setTickets] = useState<BingoTicket[]>([]);
  const [drawnNumbers, setDrawnNumbers] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugImage, setDebugImage] = useState<string | null>(null);
  
  // Preview State
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [rawImageForProcessing, setRawImageForProcessing] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  
  // Custom Confirmation Modal State
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);

  const drawnSet = new Set(drawnNumbers);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setDebugImage(null);
    setPreviewImage(null);
    setValidationResult(null);

    try {
      // 1. Prepare Image
      const resizedDataUrl = await compressImage(file);
      setRawImageForProcessing(resizedDataUrl);

      // 2. Fast Validation (No OCR)
      const check = await validateTicketImage(resizedDataUrl);
      setValidationResult(check || { isValid: true, message: "Validierung übersprungen", ticketCount: 1 });
      
      // 3. Show Preview
      if (check?.overlayImage) {
          setPreviewImage(check.overlayImage);
      } else {
          setPreviewImage(resizedDataUrl); // Fallback
      }
      
    } catch (e) {
      console.error(e);
      setError("Fehler beim Laden des Bildes.");
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmAndAnalyze = async () => {
      if (!rawImageForProcessing) return;
      
      setPreviewImage(null); // Hide preview
      setIsProcessing(true); // Start full loading
      
      try {
        const { results, debugDataUrl } = await analyzeTicketImage(rawImageForProcessing);
        
        if (debugDataUrl) setDebugImage(debugDataUrl);

        if (!results || results.length === 0) {
           setError("Keine Scheine erkannt. Bitte überprüfe das Debug-Bild unten.");
           return;
        }

        const newTickets: BingoTicket[] = results.map(result => ({
          id: result.ticketId,
          internalId: generateId(),
          rows: result.grid,
          isWinner: false,
        }));

        setTickets(prev => {
            const existingIds = new Set(prev.map(t => t.id));
            const uniqueNewTickets = newTickets.filter(t => !existingIds.has(t.id));
            return [...prev, ...uniqueNewTickets];
        });

      } catch (e: any) {
        console.error(e);
        setError(e.message || "Fehler bei der Analyse.");
      } finally {
          setIsProcessing(false);
          setRawImageForProcessing(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
  };

  const handleRetake = () => {
      setPreviewImage(null);
      setRawImageForProcessing(null);
      setValidationResult(null);
      setError(null);
      if (fileInputRef.current) {
          fileInputRef.current.value = '';
          fileInputRef.current.click(); // Immediately reopen camera
      }
  };

  const handleAddNumber = useCallback((num: number) => {
    if (drawnNumbers.includes(num)) return;
    setDrawnNumbers(prev => [...prev, num]);
  }, [drawnNumbers]);

  const handleUndo = useCallback(() => {
    setDrawnNumbers(prev => prev.slice(0, -1));
  }, []);

  const handleRemoveNumber = useCallback((numToRemove: number) => {
    setDrawnNumbers(prev => prev.filter(n => n !== numToRemove));
  }, []);

  // Request to delete a single ticket
  const handleDeleteTicketRequest = useCallback((internalId: string) => {
    setConfirmation({
        isOpen: true,
        title: "Schein löschen",
        message: "Möchtest du diesen Schein wirklich entfernen?",
        onConfirm: () => {
            setTickets(prev => prev.filter(t => t.internalId !== internalId));
            setConfirmation(null);
        }
    });
  }, []);

  const handleUpdateTicket = useCallback((internalId: string, newRows: number[][], newTicketId: string) => {
    setTickets(prev => prev.map(t => {
        if (t.internalId === internalId) {
            return { ...t, rows: newRows, id: newTicketId };
        }
        return t;
    }));
  }, []);

  const handleResetGameRequest = () => {
    setConfirmation({
        isOpen: true,
        title: "Neues Spiel",
        message: "Möchtest du alle gezogenen Zahlen zurücksetzen?",
        onConfirm: () => {
            setDrawnNumbers([]);
            setConfirmation(null);
        }
    });
  };

  const handleClearAllRequest = () => {
     setConfirmation({
        isOpen: true,
        title: "Alles löschen",
        message: "Warnung: Alle Scheine und Zahlen werden gelöscht!",
        onConfirm: () => {
            setDrawnNumbers([]);
            setTickets([]);
            setDebugImage(null);
            setConfirmation(null);
        }
    });
  };

  const hasWinner = tickets.some(ticket => {
      if (!ticket.rows) return false;
      return ticket.rows.every(row => {
          const hasNumbers = row.some(cell => cell > 0);
          return hasNumbers && row.every(cell => cell === 0 || drawnSet.has(cell));
      });
  });

  return (
    <div className="flex flex-col h-full bg-slate-50 relative">
      
      {/* CONFIRMATION MODAL - Using Fixed to ensure visibility over scroll */}
      {confirmation && confirmation.isOpen && (
          <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4" role="dialog">
              <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm animate-in fade-in zoom-in duration-200">
                  <h3 className="text-lg font-bold text-slate-900 mb-2">{confirmation.title}</h3>
                  <p className="text-slate-600 mb-6">{confirmation.message}</p>
                  <div className="flex justify-end gap-3">
                      <button 
                        onClick={() => setConfirmation(null)}
                        className="px-4 py-2 rounded-lg text-slate-600 font-semibold hover:bg-slate-100 transition-colors"
                      >
                          Abbrechen
                      </button>
                      <button 
                        onClick={confirmation.onConfirm}
                        className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors shadow-sm"
                      >
                          Bestätigen
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* PREVIEW MODAL */}
      {previewImage && (
          <div className="fixed inset-0 z-[90] bg-slate-900 flex flex-col items-center justify-center p-4" role="dialog" aria-modal="true">
              <div className="w-full max-w-lg bg-black rounded-lg overflow-hidden shadow-2xl flex flex-col max-h-full">
                  <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
                      <img src={previewImage} alt="Preview" className="max-w-full max-h-full object-contain" />
                      
                      {/* Validation Badge */}
                      <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full font-bold shadow-lg flex items-center gap-2 ${validationResult?.isValid ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                          {validationResult?.isValid ? (
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                          ) : (
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                          )}
                          <span>{validationResult?.message}</span>
                      </div>
                  </div>
                  
                  <div className="bg-slate-800 p-4 flex gap-4 shrink-0">
                      <button 
                        onClick={handleRetake}
                        className="flex-1 py-3 rounded-lg font-bold bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
                      >
                          Wiederholen
                      </button>
                      <button 
                        onClick={confirmAndAnalyze}
                        disabled={!validationResult?.isValid}
                        className={`flex-1 py-3 rounded-lg font-bold transition-colors ${!validationResult?.isValid ? 'bg-slate-600 text-slate-400 opacity-50 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
                      >
                          Verwenden
                      </button>
                  </div>
              </div>
          </div>
      )}

      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm z-30 shrink-0 sticky top-0">
        <div className="flex items-center gap-2">
           <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">B</div>
           <h1 className="font-bold text-slate-800 text-lg">Bingo Master</h1>
        </div>
        <div className="flex gap-2">
            {tickets.length > 0 && (
                <button onClick={handleResetGameRequest} className="text-xs font-semibold text-blue-600 px-3 py-2 bg-blue-50 rounded hover:bg-blue-100 transition-colors">Reset</button>
            )}
            {tickets.length > 0 && (
                 <button onClick={handleClearAllRequest} className="text-xs font-semibold text-red-600 px-3 py-2 bg-red-50 rounded hover:bg-red-100 transition-colors">Löschen</button>
            )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto space-y-6 pb-24">
            
            {hasWinner && (
                <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded shadow-sm flex items-center gap-3">
                    <span className="text-2xl">🎉</span>
                    <div>
                        <p className="font-bold text-lg">BINGO!</p>
                        <p className="text-sm opacity-90">Herzlichen Glückwunsch!</p>
                    </div>
                </div>
            )}

            {error && (
                <div className="bg-red-100 border border-red-200 text-red-700 px-4 py-3 rounded relative">
                    {error}
                </div>
            )}

            {debugImage && (
                <div className="bg-slate-900 rounded-xl p-4 shadow-lg border border-slate-700">
                    <h3 className="text-slate-200 font-semibold mb-2 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                        Debug Ansicht
                    </h3>
                    <div className="relative rounded overflow-hidden border border-slate-600 bg-white">
                         <img src={debugImage} className="w-full h-auto" alt="Debug Analysis" />
                    </div>
                </div>
            )}

            {tickets.length === 0 && !isProcessing && !debugImage && (
                <div className="text-center py-12 px-4">
                    <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
                    </div>
                    <p className="text-slate-500 font-medium">Noch keine Scheine gescannt.</p>
                    <p className="text-slate-400 text-sm mt-1">Klicke auf die Kamera, um zu starten.</p>
                </div>
            )}

            {isProcessing && (
                <div className="bg-white rounded-xl p-8 shadow-sm border border-slate-200 text-center animate-pulse">
                     <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
                     <p className="text-slate-600 font-medium">Analysiere Bild...</p>
                     <p className="text-xs text-slate-400 mt-2">Dies kann einen Moment dauern.</p>
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tickets.map(ticket => (
                    <TicketCard 
                        key={ticket.internalId} 
                        ticket={ticket} 
                        drawnNumbers={drawnSet}
                        onDelete={handleDeleteTicketRequest}
                        onUpdate={handleUpdateTicket}
                    />
                ))}
            </div>

            <div className="h-20"></div>
        </div>
      </main>

      <div className={`fixed bottom-24 right-6 z-40`}>
        <label className="cursor-pointer group flex items-center gap-2">
            <input 
                ref={fileInputRef}
                type="file" 
                accept="image/*" 
                capture="environment"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isProcessing}
            />
            <div className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-all transform group-hover:scale-105 active:scale-95 ${isProcessing ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </div>
        </label>
      </div>

      {tickets.length > 0 && (
         <NumberInput 
            onAddNumber={handleAddNumber} 
            lastDrawn={drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null}
            onUndo={handleUndo}
            canUndo={drawnNumbers.length > 0}
            allDrawnNumbers={drawnNumbers}
            onRemoveNumber={handleRemoveNumber}
         />
      )}
    </div>
  );
}