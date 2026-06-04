import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FlashcardSession } from '../components/flashcards/FlashcardSession';
import type { Deck } from '../types/deck';

type State =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'success'; deck: Deck };

export default function FlashcardsPage() {
    const { deckId } = useParams<{ deckId: string }>();
    const navigate = useNavigate();
    const [state, setState] = useState<State>({ status: 'loading' });

    // Swap viewport to device-width for mobile — restore on unmount
    useEffect(() => {
        const meta = document.querySelector('meta[name="viewport"]');
        const original = meta?.getAttribute('content') ?? 'width=1280';
        meta?.setAttribute('content', 'width=device-width, initial-scale=1');
        return () => { meta?.setAttribute('content', original); };
    }, []);

    useEffect(() => {
        if (!deckId) {
            setState({ status: 'error', message: 'Колода не указана.' });
            return;
        }
        setState({ status: 'loading' });
        fetch(`/decks/${deckId}.json`)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<Deck>;
            })
            .then((deck) => setState({ status: 'success', deck }))
            .catch(() =>
                setState({ status: 'error', message: `Колода "${deckId}" не найдена или повреждена.` })
            );
    }, [deckId]);

    if (state.status === 'loading') {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-slate-400 text-sm animate-pulse">Загрузка колоды…</div>
            </div>
        );
    }

    if (state.status === 'error') {
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-6 p-6 text-center">
                <div className="text-4xl">✈️</div>
                <h1 className="text-white text-xl font-bold">Колода не найдена</h1>
                <p className="text-slate-400 text-sm max-w-sm">{state.message}</p>
                <button
                    onClick={() => navigate('/flashcards')}
                    className="px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold transition-colors"
                >
                    ← Все колоды
                </button>
            </div>
        );
    }

    return (
        <FlashcardSession
            lesson={state.deck}
            onExit={() => navigate('/flashcards')}
        />
    );
}
