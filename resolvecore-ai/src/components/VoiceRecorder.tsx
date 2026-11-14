import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Volume2 } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface VoiceRecorderProps {
  token: string | null;
  onTranscriptReady: (transcript: string) => void;
}

export function VoiceRecorder({ token, onTranscriptReady }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechRecRef = useRef<any>(null);
  const liveSpeechTextRef = useRef<string>('');

  const cleanupAudio = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // ignore
      }
      speechRecRef.current = null;
    }
  };

  useEffect(() => {
    return () => cleanupAudio();
  }, []);

  const drawWaveform = (analyser: AnalyserNode) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const renderFrame = () => {
      animFrameRef.current = requestAnimationFrame(renderFrame);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barCount = 32;
      const step = Math.floor(bufferLength / barCount);
      const barWidth = (canvas.width - (barCount - 1) * 3) / barCount;

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i * step] || 0;
        const barHeight = Math.max(4, (val / 255) * (canvas.height - 6));
        const x = i * (barWidth + 3);
        const y = (canvas.height - barHeight) / 2;
        ctx.fillStyle = '#2563EB';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };
    renderFrame();
  };

  const startRecording = async () => {
    setError(null);
    setStatusMessage(null);
    liveSpeechTextRef.current = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      drawWaveform(analyser);

      // Optional browser SpeechRecognition parallel capture for instant fallback
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = false;
          rec.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
              if (event.results[i].isFinal) {
                liveSpeechTextRef.current += ` ${event.results[i][0].transcript}`;
              }
            }
          };
          rec.start();
          speechRecRef.current = rec;
        } catch {
          // ignore if speech recognition unavailable
        }
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        cleanupAudio();
        setRecording(false);
        await processAudioBlob(blob, mimeType);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError('Microphone access was denied or unavailable. Please check browser permissions.');
      cleanupAudio();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupAudio();
      setRecording(false);
    }
  };

  const processAudioBlob = async (blob: Blob, mimeType: string) => {
    setTranscribing(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = String(reader.result || '');
          resolve(result.split(',')[1] || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const res = await apiFetch<{ transcript: string; isDemoMode: boolean; modelUsed: string }>(
        '/api/ai/transcribe',
        {
          method: 'POST',
          token,
          body: JSON.stringify({ audioBase64: base64, mimeType }),
        }
      );

      if (res.transcript) {
        onTranscriptReady(res.transcript);
        setStatusMessage(`Voice detected and transcribed via ${res.modelUsed}.`);
      } else if (liveSpeechTextRef.current.trim()) {
        onTranscriptReady(liveSpeechTextRef.current.trim());
        setStatusMessage('Voice transcribed using browser speech detection (AI Demo Mode active).');
      } else {
        setError('Demo Mode: Configure GEMINI_API_KEY for server-side multilingual voice transcription, or type details below.');
      }
    } catch (err: any) {
      if (liveSpeechTextRef.current.trim()) {
        onTranscriptReady(liveSpeechTextRef.current.trim());
        setStatusMessage('Captured voice via local browser speech recognition.');
      } else {
        setError(err?.message || 'Unable to transcribe audio recording.');
      }
    } finally {
      setTranscribing(false);
    }
  };

  const formattedTime = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-[#0F172A] text-white flex items-center justify-center shrink-0">
            <Volume2 className="w-4 h-4 text-[#60A5FA]" />
          </div>
          <div>
            <div className="text-xs font-semibold text-[#0F172A]">
              Voice Intake for Detailed Description
            </div>
            <div className="text-[11px] text-slate-500">
              Speak in any language to transcribe directly into the description box.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {recording && (
            <span className="font-mono text-xs font-semibold text-[#DC2626] tabular-nums">
              REC {formattedTime}
            </span>
          )}
          {!recording ? (
            <button
              type="button"
              disabled={transcribing}
              onClick={startRecording}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <Mic className="w-3.5 h-3.5 text-[#60A5FA]" />
              {transcribing ? 'Transcribing...' : 'Dictate Description'}
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Stop & Transcribe
            </button>
          )}
        </div>
      </div>

      {recording && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-200">
          <canvas ref={canvasRef} width={560} height={36} className="w-full h-9 rounded bg-white border border-slate-200" />
        </div>
      )}

      {statusMessage && (
        <p className="mt-2 text-xs font-medium text-[#16A34A]">{statusMessage}</p>
      )}
      {error && <p className="mt-2 text-xs font-medium text-[#DC2626]">{error}</p>}
    </div>
  );
}
