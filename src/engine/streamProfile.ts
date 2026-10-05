import type { StreamAnswerKey, StreamAnswers, StreamProfile } from './types';

/**
 * The five stream check questions. Every answer maps to starting values that
 * are illustrative, not a measurement. "I'm not sure" always uses a middle value.
 */
export interface AnswerOption<K extends StreamAnswerKey = StreamAnswerKey> {
  value: StreamAnswers[K];
  label: string;
  hint: string;
}

export interface StreamQuestion<K extends StreamAnswerKey = StreamAnswerKey> {
  key: K;
  question: string;
  explain: string;
  options: AnswerOption<K>[];
}

export const STREAM_QUESTIONS: { [K in StreamAnswerKey]: StreamQuestion<K> } = {
  clarity: {
    key: 'clarity',
    question: 'How clear is the water?',
    explain: 'Cloudy or green water usually means extra nutrients (from fertiliser, soil or waste) that feed algae.',
    options: [
      { value: 'clear', label: 'Clear to the bottom', hint: 'You can see stones on the bed.' },
      { value: 'cloudy', label: 'A bit cloudy', hint: 'You can just about see the bottom.' },
      { value: 'murky', label: 'Murky or green', hint: 'You cannot see the bottom, or it looks like pea soup.' },
      { value: 'unsure', label: "I'm not sure", hint: 'We will use a middle value.' },
    ],
  },
  smell: {
    key: 'smell',
    question: 'Does it smell?',
    explain: 'A sewage or rotten egg smell is a sign of waste breaking down, which uses up the oxygen animals breathe.',
    options: [
      { value: 'none', label: 'No smell', hint: 'Smells fresh or of nothing.' },
      { value: 'earthy', label: 'Earthy', hint: 'Like wet soil or leaves.' },
      { value: 'sewage', label: 'Sewage or rotten eggs', hint: 'Unpleasant, like drains or eggs.' },
      { value: 'unsure', label: "I'm not sure", hint: 'We will use a middle value.' },
    ],
  },
  banks: {
    key: 'banks',
    question: 'What grows on the banks?',
    explain: 'Bank trees shade the water and soak up runoff before it reaches the stream.',
    options: [
      { value: 'trees', label: 'Trees on both sides', hint: 'Shady, with roots at the edge.' },
      { value: 'bushes', label: 'Some bushes', hint: 'Patchy cover, some sun on the water.' },
      { value: 'grass', label: 'Mown grass', hint: 'Open and sunny.' },
      { value: 'concrete', label: 'Concrete', hint: 'Walls or paving right up to the water.' },
      { value: 'unsure', label: "I'm not sure", hint: 'We will use a middle value.' },
    ],
  },
  creatures: {
    key: 'creatures',
    question: 'What small creatures have you seen?',
    explain: 'Which creatures live in a stream tells you about its water. Some need clean water, others survive almost anything.',
    options: [
      { value: 'many', label: 'Many kinds', hint: 'Bugs under stones, small fish, things swimming.' },
      { value: 'few', label: 'A few kinds', hint: 'One or two sorts of creature.' },
      { value: 'worms', label: 'Only worms, or none', hint: 'Red worms in the mud, or nothing at all.' },
      { value: 'unsure', label: "I'm not sure", hint: 'We will use a middle value.' },
    ],
  },
  flow: {
    key: 'flow',
    question: 'How does the water move?',
    explain: 'Moving water mixes in oxygen. Still water warms up and lets mosquitoes breed.',
    options: [
      { value: 'fast', label: 'Fast and rippling', hint: 'Small waves over stones.' },
      { value: 'slow', label: 'Slow', hint: 'Moving, but gently.' },
      { value: 'still', label: 'Still pools', hint: 'Hardly moving at all.' },
      { value: 'unsure', label: "I'm not sure", hint: 'We will use a middle value.' },
    ],
  },
};

export const QUESTION_ORDER: StreamAnswerKey[] = ['clarity', 'smell', 'banks', 'creatures', 'flow'];

/** A healthy urban stream used by "Try a sample stream". */
export const SAMPLE_ANSWERS: StreamAnswers = {
  clarity: 'clear',
  smell: 'none',
  banks: 'bushes',
  creatures: 'many',
  flow: 'fast',
};

export const UNSURE_ANSWERS: StreamAnswers = {
  clarity: 'unsure',
  smell: 'unsure',
  banks: 'unsure',
  creatures: 'unsure',
  flow: 'unsure',
};

export function isValidAnswers(value: unknown): value is StreamAnswers {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return QUESTION_ORDER.every((k) =>
    STREAM_QUESTIONS[k].options.some((o) => o.value === v[k]),
  );
}

/** Turns the five answers into the starting world. */
export function buildProfile(answers: StreamAnswers): StreamProfile {
  const notes: string[] = [];

  const clarity = {
    clear: { nutrients: 14, algae: 0.22, turbidity: 4 },
    cloudy: { nutrients: 34, algae: 0.38, turbidity: 28 },
    murky: { nutrients: 62, algae: 0.62, turbidity: 45 },
    unsure: { nutrients: 34, algae: 0.38, turbidity: 20 },
  }[answers.clarity];

  const smell = {
    none: { pathogens: 5, organicLoad: 4 },
    earthy: { pathogens: 14, organicLoad: 14 },
    sewage: { pathogens: 55, organicLoad: 48 },
    unsure: { pathogens: 14, organicLoad: 14 },
  }[answers.smell];

  const banks = {
    trees: { treeCover: 0.88, pavement: 0.25 },
    bushes: { treeCover: 0.45, pavement: 0.4 },
    grass: { treeCover: 0.08, pavement: 0.4 },
    concrete: { treeCover: 0, pavement: 0.92 },
    unsure: { treeCover: 0.4, pavement: 0.45 },
  }[answers.banks];

  const population = {
    many: { mayfly: 34, midge: 22, mosquito: 6, fish: 9 },
    few: { mayfly: 10, midge: 26, mosquito: 12, fish: 5 },
    worms: { mayfly: 0, midge: 32, mosquito: 16, fish: 1 },
    unsure: { mayfly: 16, midge: 24, mosquito: 10, fish: 6 },
  }[answers.creatures];

  const flow = { fast: 70, slow: 45, still: 18, unsure: 45 }[answers.flow];

  const labels: Record<keyof StreamAnswers, string> = {
    clarity: 'water clarity',
    smell: 'smell',
    banks: 'bank plants',
    creatures: 'creatures seen',
    flow: 'how the water moves',
  };
  for (const key of QUESTION_ORDER) {
    if (answers[key] === 'unsure') notes.push(`You were not sure about ${labels[key]}, so a middle value is used.`);
  }

  return {
    answers: { ...answers },
    nutrients: clarity.nutrients,
    algae: clarity.algae,
    turbidity: clarity.turbidity,
    pathogens: smell.pathogens,
    organicLoad: smell.organicLoad,
    treeCover: banks.treeCover,
    pavement: banks.pavement,
    flow,
    population: { ...population },
    notes,
  };
}

/** Short plain-language summary of a profile, shown when the stream appears. */
export function describeProfile(profile: StreamProfile): string {
  const a = profile.answers;
  const parts: string[] = [];
  parts.push(
    a.clarity === 'clear' ? 'clear water' : a.clarity === 'cloudy' ? 'slightly cloudy water' : a.clarity === 'murky' ? 'murky, nutrient-rich water' : 'water of unknown clarity',
  );
  parts.push(
    a.banks === 'trees' ? 'shady tree-lined banks' : a.banks === 'bushes' ? 'patchy bushes on the banks' : a.banks === 'grass' ? 'open grassy banks' : a.banks === 'concrete' ? 'concrete banks' : 'banks of unknown cover',
  );
  parts.push(a.flow === 'fast' ? 'fast flow' : a.flow === 'slow' ? 'slow flow' : a.flow === 'still' ? 'still pools' : 'moderate flow');
  if (a.smell === 'sewage') parts.push('signs of sewage');
  return `A stream with ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
}
