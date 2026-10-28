import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface DeckMeta {
    deckId: string;
    name: string;
    difficulty: string;
    steps: number;
}

const DIFFICULTY_LABEL: Record<string, string> = {
    beginner: 'Начальный',
    intermediate: 'Средний',
    advanced: 'Продвинутый',
};

const DIFFICULTY_COLOR: Record<string, string> = {
    beginner: 'text-green-400 border-green-700 bg-green-900/20',
    intermediate: 'text-yellow-400 border-yellow-700 bg-yellow-900/20',
    advanced: 'text-red-400 border-red-700 bg-red-900/20',
};

export default function FlashcardsIndex() {
    const navigate = useNavigate();
    const [decks, setDecks] = useState<DeckMeta[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Swap viewport to device-width for mobile — restore on unmount
    useEffect(() => {
        const meta = document.querySelector('meta[name="viewport"]');
        const original = meta?.getAttribute('content') ?? 'width=1280';
        meta?.setAttribute('content', 'width=device-width, initial-scale=1');
        return () => { meta?.setAttribute('content', original); };
    }, []);

    useEffect(() => {
        fetch('/decks/manifest.json')
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<DeckMeta[]>;
            })
            .then((data) => { setDecks(data); setLoading(false); })
            .catch(() => { setError('Не удалось загрузить список колод.'); setLoading(false); });
    }, []);

    return (
        <div className="min-h-screen bg-slate-900 text-white font-inter">
            {/* Header */}
            <div className="border-b border-slate-800 px-4 sm:px-8 py-4 flex items-center justify-between">
                <div>
                    <a href="https://skytalk.website" className="text-lg font-bold text-white hover:text-sky-400 transition-colors">SkyTalk Flashcards</a>
                    <p className="text-xs text-slate-500 mt-0.5">Авиационная фразеология ICAO</p>
                </div>
                <a
                    href="https://t.me/Thinkee"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-sky-600/20 border border-sky-600/50 text-sky-400 hover:bg-sky-600/30 transition-colors text-xs font-bold whitespace-nowrap"
                >
                    Живой урок →
                </a>
            </div>

            {/* Content */}
            <div className="max-w-2xl mx-auto px-4 sm:px-8 py-8">
                {loading && (
                    <p className="text-slate-400 text-sm animate-pulse">Загрузка…</p>
                )}

                {error && (
                    <p className="text-red-400 text-sm">{error}</p>
                )}

                {!loading && !error && (
                    <div className="space-y-3">
                        <p className="text-slate-400 text-sm mb-6">Выбери колоду для тренировки:</p>
                        {decks.map((deck) => (
                            <button
                                key={deck.deckId}
                                onClick={() => navigate(`/flashcards/${deck.deckId}`)}
                                className="w-full text-left p-4 sm:p-5 rounded-xl bg-slate-800 border border-slate-700 hover:border-sky-600 hover:bg-slate-750 transition-colors group"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-white font-bold text-sm sm:text-base group-hover:text-sky-300 transition-colors truncate">
                                            {deck.name}
                                        </div>
                                        <div className="text-slate-400 text-xs mt-1">
                                            {deck.steps} карточек
                                        </div>
                                    </div>
                                    <span className={`shrink-0 px-2 py-0.5 rounded border text-xs font-bold ${DIFFICULTY_COLOR[deck.difficulty] ?? 'text-slate-400 border-slate-600'}`}>
                                        {DIFFICULTY_LABEL[deck.difficulty] ?? deck.difficulty}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
