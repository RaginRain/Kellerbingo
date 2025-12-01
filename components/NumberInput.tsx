import React, { useState } from 'react';

interface NumberInputProps {
  onAddNumber: (num: number) => void;
  lastDrawn: number | null;
  onUndo: () => void;
  onRemoveNumber: (num: number) => void;
  canUndo: boolean;
  allDrawnNumbers: number[];
}

export const NumberInput: React.FC<NumberInputProps> = ({ 
  onAddNumber, 
  lastDrawn, 
  onUndo, 
  canUndo, 
  allDrawnNumbers,
  onRemoveNumber 
}) => {
  const [inputValue, setInputValue] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const num = parseInt(inputValue, 10);
    if (!isNaN(num) && num > 0 && num <= 99) {
      onAddNumber(num);
      setInputValue('');
    }
  };

  return (
    <div className="bg-white p-4 border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-20">
      <div className="max-w-3xl mx-auto flex flex-col gap-3">
        
        {/* Status Bar */}
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <span className="text-slate-500 text-sm font-medium">Zuletzt:</span>
                <div className="h-10 w-10 flex items-center justify-center bg-blue-600 text-white font-bold text-xl rounded-full shadow-md">
                    {lastDrawn ?? '-'}
                </div>
                <button 
                  onClick={() => setShowHistory(!showHistory)}
                  className="text-xs text-blue-600 font-medium hover:underline ml-2"
                >
                  {showHistory ? 'Verlauf verbergen' : `Alle anzeigen (${allDrawnNumbers.length})`}
                </button>
            </div>
             <button 
                onClick={onUndo}
                disabled={!canUndo}
                className={`text-sm px-3 py-1 rounded-full border ${!canUndo ? 'text-slate-300 border-slate-200' : 'text-slate-600 border-slate-300 hover:bg-slate-50'}`}
            >
                Rückgängig
            </button>
        </div>

        {/* Expanded History View */}
        {showHistory && allDrawnNumbers.length > 0 && (
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 max-h-40 overflow-y-auto">
            <p className="text-xs text-slate-500 mb-2">Tippe auf eine Zahl, um sie zu entfernen:</p>
            <div className="flex flex-wrap gap-2">
              {allDrawnNumbers.slice().reverse().map((num, idx) => (
                <button
                  key={`${num}-${idx}`}
                  onClick={() => onRemoveNumber(num)}
                  className="bg-white border border-slate-300 text-slate-700 hover:bg-red-50 hover:border-red-300 hover:text-red-600 px-2 py-1 rounded text-sm font-semibold transition-colors flex items-center gap-1 group"
                  title="Zahl löschen"
                >
                  {num}
                  <span className="text-slate-300 group-hover:text-red-400">×</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Area */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Zahl eingeben..."
            className="flex-1 rounded-lg border-slate-300 border px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            autoFocus
          />
          <button 
            type="submit"
            disabled={!inputValue}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg px-6 py-2 transition-colors shadow-sm"
          >
            OK
          </button>
        </form>
      </div>
    </div>
  );
};