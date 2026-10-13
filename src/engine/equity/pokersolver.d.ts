declare module 'pokersolver' {
  export interface SolvedHand {
    rank: number;
    name: string;
    descr: string;
    compare(other: SolvedHand): number;
  }
  const solver: {
    Hand: {
      solve(cards: string[], game?: string): SolvedHand;
      winners(hands: SolvedHand[]): SolvedHand[];
    };
  };
  export default solver;
}
