export type ScoreboardAward = {
  id: number;
  side: number;
  award: string;
  points: number;
  remainingMs: number;
  at: string;
  penaltyLevel?: number;
  opponentAward?: { side: number; award: 'ADVANTAGE' | 'POINTS'; points: number };
  scoreChanges?: { side: number; before: number; after: number }[];
  source?: 'STALLING_TIMER';
  undone?: boolean;
};

export const SCOREBOARD_REVIEW_AWARDS = ['REVIEW_REQUEST', 'REVIEW_ACCEPTED', 'REVIEW_REJECTED'];
export type ScoreboardVideoReview = { cards: { 1: boolean; 2: boolean }; pendingSide: 1 | 2 | null };
export const SCOREBOARD_AWARD_LABELS: Record<string, string> = { POINTS: 'Điểm', ADVANTAGE: 'Lợi thế', PENALTY: 'Phạt', SUBMISSION: 'Submission', ATTACK: 'Chủ động tấn công', REVIEW_REQUEST: 'Yêu cầu xem lại video', REVIEW_ACCEPTED: 'Khiếu nại đúng · Trả thẻ VR', REVIEW_REJECTED: 'Khiếu nại sai · Thu thẻ VR', STALL_START: 'Bắt đầu đếm thụ động 10 giây', STALL_CANCEL: 'Hủy đếm thụ động', MEDICAL_START: 'Bắt đầu/tiếp tục timer y tế', MEDICAL_STOP: 'Tạm dừng timer y tế', MEDICAL_EXHAUSTED: 'Đã hết thời gian y tế · Chờ quyết định', MEDICAL_FIT: 'Bác sĩ/trọng tài cho phép tiếp tục', MEDICAL_UNFIT: 'Không thể tiếp tục do y tế' };

export function formatScoreboardTime(ms: number) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
