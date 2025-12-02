import React, { useMemo, useState, useEffect } from 'react';
import { BingoTicket } from '../types';

interface TicketCardProps {
  ticket: BingoTicket;
  drawnNumbers: Set<number>;
  onDelete: (id: string) => void;
  onUpdate?: (internalId: string, newRows: number[][], newTicketId: string) => void;
}

export const TicketCard: React.FC<TicketCardProps> = ({ ticket, drawnNumbers, onDelete, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editGrid, setEditGrid] = useState<number[][]>(ticket.rows || []);
  const [editId, setEditId] = useState<string>(ticket.id || '');

  // Reset local state if prop changes from outside
  useEffect(() => {
      setEditGrid(ticket.rows || []);
      setEditId(ticket.id || '');
  }, [ticket]);

  // Check wins per row (must have >0 ink and be fully drawn)
  const rowWins = useMemo(() => {
    if (!ticket.rows) return [false, false, false];
    return ticket.rows.map(row => {
        const hasRealNumbers = row.some(n => n > 0);
        return hasRealNumbers && row.every(cell => cell === 0 || drawnNumbers.has(cell));
    });
  }, [ticket.rows, drawnNumbers]);

  const isFullWinner = rowWins.every(w => w);

  const toggleEdit = () => {
    if (isEditing && onUpdate) {
        onUpdate(ticket.internalId, editGrid, editId);
    }
    setIsEditing(!isEditing);
  };

  const handleCellChange = (rowIndex: number, colIndex: number, valStr: string) => {
      const val = parseInt(valStr);
      if (isNaN(val)) return;
      
      const newGrid = [...editGrid.map(r => [...r])];
      newGrid[rowIndex][colIndex] = val;
      setEditGrid(newGrid);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
      e.stopPropagation(); // Stop clicking the card body
      onDelete(ticket.internalId);
  };

  if (!ticket.rows) return null;

  return (
    <div className={`relative rounded-xl p-4 shadow-sm border-2 transition-all ${isFullWinner ? 'bg-yellow-50 border-yellow-400 scale-[1.02] shadow-md' : 'bg-white border-slate-200'}`}>
      
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Schein ID</span>
            {isEditing ? (
                <input 
                    type="text" 
                    value={editId}
                    onChange={(e) => setEditId(e.target.value)}
                    className="font-bold text-slate-800 border-b border-blue-500 outline-none w-24 bg-transparent"
                    autoFocus
                />
            ) : (
                <span className="font-bold text-slate-700">{ticket.id}</span>
            )}
        </div>
        
        <div className="flex items-center gap-1">
            <button 
                onClick={toggleEdit}
                className={`p-2 rounded-full transition-colors ${isEditing ? 'text-green-600 bg-green-50 hover:bg-green-100' : 'text-slate-400 hover:text-blue-600 hover:bg-slate-100'}`}
                title={isEditing ? "Speichern" : "Bearbeiten"}
            >
                {isEditing ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                )}
            </button>
            <button 
                type="button"
                onClick={handleDeleteClick}
                className="p-2 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors z-10"
                title="Löschen"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex flex-col gap-2">
        {(isEditing ? editGrid : ticket.rows).map((row, rIdx) => {
            const isRowWinner = !isEditing && rowWins[rIdx];
            return (
              <div key={rIdx} className={`flex gap-1 p-1 rounded-lg transition-colors ${isRowWinner ? 'bg-yellow-100/50' : ''}`}>
                {row.map((num, cIdx) => {
                  const isMarked = !isEditing && num > 0 && drawnNumbers.has(num);
                  const isEmpty = num === 0;
                  
                  return (
                    <div 
                        key={cIdx} 
                        className={`
                            relative flex-1 aspect-square rounded-md flex items-center justify-center font-bold text-lg select-none
                            ${isEditing ? 'border border-slate-200 bg-white' : ''}
                            ${!isEditing && isEmpty ? 'bg-slate-100 text-slate-300' : ''}
                            ${!isEditing && !isEmpty && !isMarked ? 'bg-white border border-slate-200 text-slate-700' : ''}
                            ${!isEditing && isMarked ? 'bg-blue-600 text-white shadow-sm border-blue-600' : ''}
                        `}
                    >
                        {isEditing ? (
                            <input 
                                type="number" 
                                value={num}
                                onChange={(e) => handleCellChange(rIdx, cIdx, e.target.value)}
                                className="w-full h-full text-center bg-transparent outline-none p-0"
                            />
                        ) : (
                            <>
                                {isEmpty ? '·' : num}
                                {isMarked && (
                                    <div className="absolute inset-0 flex items-center justify-center text-white/30 pointer-events-none">
                                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                  );
                })}
              </div>
            );
        })}
      </div>
    </div>
  );
};