import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoredToken, useAuth } from '../hooks/useAuth';
import { type RoomValidationError, useRooms } from '../hooks/useRooms';

export default function TutorDashboard() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { rooms, createRoom, deleteRoom } = useRooms();

  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [studentName, setStudentName] = useState('');
  const [creating, setCreating] = useState(false);
  const [errors, setErrors] = useState<RoomValidationError[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!getStoredToken()) navigate('/tutor', { replace: true });
  }, [navigate]);

  function clearErrors() {
    setErrors([]);
    setErrorMessage('');
  }

  function handleFile(file: File) {
    clearErrors();
    setSelectedFile(file);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave() {
    setDragOver(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }

  async function submit() {
    if (!selectedFile || creating) return;
    setCreating(true);
    clearErrors();
    const result = await createRoom(selectedFile, studentName);
    setCreating(false);
    if (result.ok) {
      setSelectedFile(null);
      setStudentName('');
    } else {
      setErrors(result.errors);
      setErrorMessage(result.message);
    }
  }

  async function copyToClipboard(text: string, roomId: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(roomId);
    setTimeout(() => setCopiedId((id) => (id === roomId ? null : id)), 2000);
  }

  function formatExpiry(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Tutor Dashboard</h1>
          <button
            type="button"
            onClick={() => { logout(); navigate('/tutor', { replace: true }); }}
            className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-red-700 hover:text-red-400 transition-colors"
          >
            Exit
          </button>
        </div>

        {/* Create new room */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-gray-300">New session</h2>

          {/* Drop zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={[
              'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-sm transition-colors',
              dragOver
                ? 'border-sky-400 bg-sky-950 text-sky-300'
                : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500',
            ].join(' ')}
          >
            {selectedFile ? (
              <span className="text-white">{selectedFile.name}</span>
            ) : (
              <>
                <span>Drop flight.json here</span>
                <span className="mt-1 text-gray-500">or click to browse</span>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            aria-label="Select flight.json file"
            onChange={onFileChange}
            className="hidden"
          />

          {/* Validation errors */}
          {(errorMessage || errors.length > 0) && (
            <div className="rounded border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300 space-y-1">
              {errorMessage && <p>{errorMessage}</p>}
              {errors.length > 0 && (
                <ul className="list-disc list-inside space-y-0.5">
                  {errors.map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Student name + submit */}
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Student name (optional)"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              disabled={creating}
              className="flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-sky-500 focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!selectedFile || creating}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {creating ? 'Creating…' : 'Create room'}
            </button>
          </div>
        </section>

        {/* Room list */}
        {rooms.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-lg font-medium text-gray-300">Active rooms</h2>
            <ul className="space-y-3">
              {rooms.map((room) => (
                <li
                  key={room.room_id}
                  className="rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{room.lesson_name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Expires {formatExpiry(room.expires_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => navigate(new URL(room.tutor_url).pathname + new URL(room.tutor_url).search)}
                        className="rounded bg-sky-700 px-3 py-1 text-xs font-medium text-white hover:bg-sky-600"
                      >
                        Open session
                      </button>
                      {confirmDeleteId === room.room_id ? (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              setDeleting(room.room_id);
                              await deleteRoom(room.room_id);
                              setDeleting(null);
                              setConfirmDeleteId(null);
                            }}
                            disabled={deleting === room.room_id}
                            className="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
                          >
                            {deleting === room.room_id ? 'Deleting…' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:text-white"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(room.room_id)}
                          className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-400 hover:border-red-600 hover:text-red-400"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="truncate rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 flex-1 font-mono">
                      {room.student_url}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(room.student_url, room.room_id)}
                      className="shrink-0 rounded border border-gray-700 px-3 py-1 text-xs text-gray-300 hover:border-gray-500 hover:text-white"
                    >
                      {copiedId === room.room_id ? 'Copied!' : 'Copy link'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
