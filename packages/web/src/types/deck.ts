export interface DeckStep {
  step: number;
  phase: string;
  atc: string;
  expected_readback: string;
  atc_translation_ru?: string;
  readback_translation_ru?: string;
}

export interface Deck {
  schema_version: string;
  lesson: {
    name: string;
    callsign: string;
    route: string;
    aircraft_type: string;
    difficulty: string;
  };
  steps: DeckStep[];
}
