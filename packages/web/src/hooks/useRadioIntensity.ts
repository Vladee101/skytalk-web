import { useState } from 'react';

const STORAGE_KEY = 'skytalk:radio_intensity';

export function useRadioIntensity() {
  const [intensity, setIntensityState] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved !== null ? Number(saved) : 20;
  });

  function setIntensity(v: number) {
    setIntensityState(v);
    localStorage.setItem(STORAGE_KEY, String(v));
  }

  return [intensity, setIntensity] as const;
}
