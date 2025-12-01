
export interface BingoTicket {
  id: string; // The extracted ID (e.g., "160/400")
  internalId: string; // UUID for React keys
  rows: number[][]; // 0 represents an empty/free space
  isWinner: boolean;
}

export type ViewState = 'scan' | 'game';

export interface ScanResult {
  ticketId: string;
  grid: number[][];
}

export interface AnalysisResponse {
    results: ScanResult[];
    debugDataUrl?: string;
}

export interface ValidationResult {
    isValid: boolean;
    message: string;
    overlayImage?: string;
    ticketCount: number;
}
