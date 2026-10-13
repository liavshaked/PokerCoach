import { describe, expect, it } from 'vitest';
import type { Card, Difficulty } from '../types/poker';
import { createDeck } from './cards';
import { generateScenario } from './generation';
function containsStraight(cards: readonly Card[]): boolean {
  const values = new Set(cards.map((card) => '23456789TJQKA'.indexOf(card.rank) + 2));
  if (values.has(14)) values.add(1);
  for (let high = 5; high <= 14; high++)
    if (Array.from({ length: 5 }, (_, i) => high - i).every((rank) => values.has(rank)))
      return true;
  return false;
}
describe('direct drawing outs and meaningful difficulty', () => {
  it('independently counts every unseen card completing the named draw on 300 generated boards', () => {
    for (let i = 0; i < 300; i++) {
      const scenario = generateScenario({
        seed: `outs-check-${i}`,
        category: 'drawing-odds',
        street: i % 2 ? 'flop' : 'turn',
        difficulty: (['beginner', 'intermediate', 'advanced'] as Difficulty[])[i % 3],
      });
      const visible = [...scenario.heroCards, ...scenario.board],
        remaining = createDeck(visible),
        outs = scenario.generated!.math!.outs;
      if (scenario.prompt.includes('straight')) {
        expect(containsStraight(visible)).toBe(false);
        expect(remaining.filter((card) => containsStraight([...visible, card])).length).toBe(outs);
      } else {
        const flushSuit = visible.find(
          (card) => visible.filter((other) => other.suit === card.suit).length === 4,
        )!.suit;
        expect(remaining.filter((card) => card.suit === flushSuit).length).toBe(outs);
      }
    }
  });
  it('changes draw horizon, answer precision and supported history complexity without changing grading rules', () => {
    const beginner = generateScenario({
      seed: 'difficulty-example',
      category: 'drawing-odds',
      street: 'flop',
      difficulty: 'beginner',
    });
    const advanced = generateScenario({
      seed: 'difficulty-example',
      category: 'drawing-odds',
      street: 'flop',
      difficulty: 'advanced',
    });
    expect(beginner.prompt).toContain('next card');
    expect(advanced.prompt).toContain('by the river');
    expect(beginner.exercise!.answers).toHaveLength(3);
    expect(advanced.exercise!.answers).toHaveLength(4);
    expect(
      beginner.exercise!.answers.filter((answer) => answer.grade === 'preferred'),
    ).toHaveLength(1);
    expect(
      advanced.exercise!.answers.filter((answer) => answer.grade === 'preferred'),
    ).toHaveLength(1);
    expect(beginner.source.category).toBe('mathematical-model');
    expect(advanced.source.category).toBe('mathematical-model');
  });
});
