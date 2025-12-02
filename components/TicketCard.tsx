import React, { useMemo, useState } from 'react';
import { BingoTicket } from '../types';

interface TicketCardProps {
  ticket: BingoTicket;
  drawnNumbers: Set<number>;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, newRows: number[][]) => void;
}

export const TicketCard: React.FC<TicketCardProps> = ({ ticket, drawnNumbers, onDelete, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editGrid, setEditGrid] = useState<number[][]>(ticket.rows || []);

  // Calculate row completion
  const rowStatus = useMemo(() => {
    if (!ticket.rows) return [];
    return ticket.rows.map(row => {
      // Row is only valid if it contains at least one non-zero number
      // and all numbers in it are drawn or zero.
      // This prevents scan errors (all zeros) from being counted as wins.
      const hasNumbers = row.some(num => num > 0);
      const isComplete = hasNumbers && row.every(num => num === 0 || drawnNumbers.has(num));
      return isComplete;
    });
  }, [ticket.rows, drawnNumbers]);

  const isFullWinner = rowStatus.length > 0 && rowStatus.every(s => s === true);

  const handleSave = () => {
    if (onUpdate) {
        onUpdate(ticket.internalId, editGrid);
    }
    setIsEditing(false);
  };

  const handleDelete = () => {
      if (window.confirm(`Möchtest du Schein ${ticket.id} wirklich löschen?`)) {
          onDelete(ticket.internalId);
      }
  };

  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    const newVal = parseInt(value);
    if (isNaN(newVal)) return;
    
    const newGrid = [...editGrid.map(r => [...r])];
    newGrid[rowIndex][colIndex] = newVal;
    setEditGrid(newGrid);
  };

  const addColumn = () => {
    const newGrid = editGrid.map(row => [...row, 0]);
    setEditGrid(newGrid);
  };

  const removeColumn = () => {
    const newGrid = editGrid.map(row => {
        if (row.length > 1) return row.slice(0, -1);
        return row;
    });
    setEditGrid(newGrid);
  };

  if (!ticket.rows) return null;

  return (
    <div className={`relative rounded-xl shadow-md border-2 overflow-hidden transition-all duration-300 ${isFullWinner && !isEditing ? 'border-yellow-400 bg-yellow-50 shadow-yellow-200 shadow-lg scale-[1.02]' : 'border-slate-200 bg-white'}`}>
      
      {/* Header */}
      <div className={`px-4 py-2 flex justify-between items-center ${isFullWinner && !isEditing ? 'bg-yellow-400 text-yellow-900' : 'bg-slate-100 text-slate-600'}`}>
        <span className="font-bold text-sm">Schein: {ticket.id}</span>
        <div className="flex items-center gap-2">
            {!isEditing && isFullWinner && (
                <span className="text-xs font-black uppercase tracking-wider bg-white/30 px-2 py-0.5 rounded">Bingo!</span>
            )}
            
            <button 
                onClick={() => setIsEditing(!isEditing)}
                className="text-slate-500 hover:text-blue-600 p-1"
                title={isEditing ? "Abbrechen" : "Bearbeiten"}
            >
                {isEditing ? (
                    <span className="text-xs font-semibold text-red-500">Abbrechen</span>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                )}
            </button>

            {!isEditing && (
                <button 
                    onClick={handleDelete}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                    title="Schein löschen"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}
        </div>
      </div>

      {/* Grid */}
      <div className="p-3 flex flex-col gap-2">
        {isEditing ? (
            // Editing Mode
            <div className="flex flex-col gap-2">
                {editGrid.map((row, rowIndex) => (
                    <div key={`edit-${rowIndex}`} className="flex gap-1">
                        {row.map((num, colIndex) => (
                            <input
                                key={colIndex}
                                type="number"
                                value={num}
                                onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                                className="w-full aspect-square text-center border border-blue-300 rounded bg-blue-50 text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        ))}
                    </div>
                ))}
                <div className="flex justify-between mt-2">
                    <div className="flex gap-2">
                        <button onClick={removeColumn} className="text-xs bg-slate-200 px-2 py-1 rounded hover:bg-slate-300">- Spalte</button>
                        <button onClick={addColumn} className="text-xs bg-slate-200 px-2 py-1 rounded hover:bg-slate-300">+ Spalte</button>
                    </div>
                    <button onClick={handleSave} className="text-xs bg-green-600 text-white px-3 py-1 rounded font-bold hover:bg-green-700">Speichern</button>
                </div>
                <p className="text-[10px] text-slate-400 text-center">Setze 0 für leeres Feld</p>
            </div>
        ) : (
            // View Mode
            ticket.rows.map((row, rowIndex) => (
            <div key={rowIndex} className="flex gap-1 justify-between relative">
                {/* Row complete indicator line */}
                {rowStatus[rowIndex] && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 opacity-40">
                        <div className="w-full h-1 bg-green-500 rounded-full"></div>
                    </div>
                )}
                
                {row.map((num, colIndex) => {
                const isZero = num === 0;
                const isMarked = !isZero && drawnNumbers.has(num);
                
                return (
                    <div 
                    key={`${rowIndex}-${colIndex}`}
                    className={`
                        flex-1 aspect-square flex items-center justify-center rounded-md text-sm sm:text-base font-bold select-none
                        ${isZero 
                            ? 'bg-slate-100 text-slate-300' // Empty field
                            : isMarked 
                                ? 'bg-green-500 text-white shadow-sm' // Marked number
                                : 'bg-white border border-slate-200 text-slate-700' // Normal number
                        }
                    `}
                    >
                    {isZero ? '•' : num}
                    </div>
                );
                })}
            </div>
            ))
        )}
      </div>
    </div>
  );
};