import React, { useEffect, useRef, useState } from 'react';

import Button from '@cloudscape-design/components/button';
import Grid from '@cloudscape-design/components/grid';
import Icon from '@cloudscape-design/components/icon';

import WaveSurfer from 'wavesurfer.js';
import RecordPlugin from 'wavesurfer.js/dist/plugins/record';

import AudioControls from '../Common/AudioControls';
import styles from './AudioRecorder.module.css';

type AudioRecorderProps = {
    setRecordedAudio: React.Dispatch<React.SetStateAction<File | undefined>>;
};

interface Recording {
    duration: string;
    index: number;
}

async function removeSilence(audioBlob: Blob, silenceThreshold = -50, minSilenceLength = 0.2): Promise<Blob> {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const minSilenceSamples = minSilenceLength * sampleRate;
  
    let nonSilentSegments: {start: number; end: number}[] = [];
    let silenceStart = 0;
    let isSilence = true;
  
    for (let i = 0; i < channelData.length; i++) {
      const amplitude = Math.abs(channelData[i]);
      const db = 20 * Math.log10(amplitude);
  
      if (db < silenceThreshold) {
        if (!isSilence) {
          isSilence = true;
          silenceStart = i;
        }
      } else {
        if (isSilence) {
          isSilence = false;
          if (i - silenceStart >= minSilenceSamples) {
            nonSilentSegments.push({ start: silenceStart / sampleRate, end: i / sampleRate });
          }
        }
      }
    }
  
    const totalDuration = nonSilentSegments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
    const offlineContext = new OfflineAudioContext(audioBuffer.numberOfChannels, totalDuration * sampleRate, sampleRate);
  
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
  
    let currentTime = 0;
    for (const segment of nonSilentSegments) {
      const duration = segment.end - segment.start;
      source.connect(offlineContext.destination);
      source.start(currentTime, segment.start, duration);
      currentTime += duration;
    }
  
    const renderedBuffer = await offlineContext.startRendering();
  
    return new Promise((resolve) => {
      const streamDestination = audioContext.createMediaStreamDestination();
      const mediaRecorder = new MediaRecorder(streamDestination.stream, { mimeType: 'audio/webm' });
  
      const source = audioContext.createBufferSource();
      source.buffer = renderedBuffer;
      source.connect(streamDestination);
  
      const chunks: BlobPart[] = [];
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
  
      mediaRecorder.start();
      source.start(0);
      setTimeout(() => mediaRecorder.stop(), renderedBuffer.duration * 1000);
    });
  }

  

export default function AudioRecorder({ setRecordedAudio }: AudioRecorderProps) {
    const wavesurfer = useRef<WaveSurfer | undefined>(undefined);
    const wavesurfermic = useRef<WaveSurfer | undefined>(undefined);
    const wavesurferRecordPlugin = useRef<RecordPlugin | undefined>(undefined);

    const [recordingStatus, setRecordingStatus] = useState('inactive');
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [showControls, setShowControls] = useState<boolean>(false);
    const [playingAudio, setPlayingAudio] = useState<boolean>(false);
    const [playBackSpeed, setPlayBackSpeed] = useState<number>(1);
    const [audioLoading, setAudioLoading] = useState<boolean>(true);
    const [stopWatchTime, setStopWatchTime] = useState(0);
    const [lastRecordingDetails, setLastRecordingDetails] = useState<Recording | null>(null);

    useEffect(() => {
        if (!wavesurfermic.current) {
            wavesurfermic.current = WaveSurfer.create({
                container: '#wavesurfermic',
                waveColor: 'rgb(9, 114, 211)',
                progressColor: 'rgb(232, 232, 232)',
                height: 40,
            });
            wavesurferRecordPlugin.current = wavesurfermic.current.registerPlugin(RecordPlugin.create());
        }
    }, []);

    useEffect(() => {
        let intervalId: NodeJS.Timeout | undefined;
        if (recordingStatus === 'recording') {
            intervalId = setInterval(() => setStopWatchTime((prev) => prev + 10), 10);
        } else {
            clearInterval(intervalId);
        }
        return () => clearInterval(intervalId);
    }, [recordingStatus]);

    const startRecording = () => {
        setRecordingStatus('recording');
        wavesurferRecordPlugin.current?.startRecording();
        setShowControls(false);
    };

    const pauseRecording = () => {
        setRecordingStatus('pauseRecording');
        wavesurferRecordPlugin.current?.pauseRecording();
        setShowControls(false);
    };

    const resumeRecording = () => {
        setRecordingStatus('recording');
        wavesurferRecordPlugin.current?.resumeRecording();
        setShowControls(false);
    };

    const stopRecording = () => {
        setRecordingStatus('recorded');
        wavesurferRecordPlugin.current?.stopRecording();
        wavesurferRecordPlugin.current?.on('record-end', async (blob) => {
            const processedBlob = await removeSilence(blob);
      
      const audioUrl = URL.createObjectURL(processedBlob);
      setRecordedAudio(new File([processedBlob], 'recorded.mp3'));
      setAudioUrl(audioUrl);
      setAudioBlob(processedBlob);
      loadWaveSurfer(audioUrl);
      setLastRecordingDetails({
        index: lastRecordingDetails === null ? 1 : lastRecordingDetails.index + 1,
        duration: `${String(Math.floor(stopWatchTime / 360000)).padStart(2, '0')}:${String(Math.floor((stopWatchTime % 360000) / 6000)).padStart(2, '0')}:${String(Math.floor((stopWatchTime % 6000) / 100)).padStart(2, '0')}`,
            });
        });
    };

    const restartRecording = () => {
        setRecordedAudio(undefined);
        setAudioUrl(null);
        setAudioLoading(true);
        setShowControls(false);
        setRecordingStatus('inactive');
        startRecording();
    };

    const loadWaveSurfer = (audioUrl: string, reset: boolean = false) => {
        if (reset || !wavesurfer.current) {
            wavesurfer.current = WaveSurfer.create({
                container: '#waveformForRecording',
                height: 40,
                normalize: false,
                waveColor: 'rgba(35, 47, 62, 0.8)',
                progressColor: '#2074d5',
                url: audioUrl,
            });
        } else {
            wavesurfer.current.load(audioUrl);
        }
        wavesurfer.current.on('ready', () => {
            setAudioLoading(false);
            setShowControls(true);
        });
        wavesurfer.current?.on('finish', () => {
            setPlayingAudio(!!wavesurfer.current?.isPlaying());
        });
    };

    return (
        <div className={styles.audioRecorderContainer}>
            <div className={styles.audioRecorderTopPanel}>
                <Grid gridDefinition={[{ colspan: { default: 1, xxs: 1 } }, { colspan: { default: 11, xxs: 11 } }]}>
                    <div className={styles.audioRecorderSpeaker}>
                        <img className={styles.audioRecorderSpeakerIcon} src="/record.png" alt={'Record Icon'} />
                    </div>
                    <div>
                        <span className={styles.audioRecorderSpeakerText}>
                            {recordingStatus === 'inactive' ? 'Click "Start" when you are ready to record' : null}
                            {recordingStatus === 'recorded' ? 'Click "Restart" to record a new session' : null}
                            {recordingStatus === 'recording' ? 'Click "Pause" to pause recording' : null}
                            {recordingStatus === 'pauseRecording' ? 'Click "Resume" to continue recording' : null}
                        </span>
                        <div
                            id="wavesurfermic"
                            className={
                                recordingStatus === 'inactive' || recordingStatus === 'recorded'
                                    ? styles.audioWavesurferInitialState
                                    : styles.audioWavesurferLoadedState
                            }
                        />
                        <div className={styles.audioRecorderRecordingControls}>
                            <Button
                                onClick={(e) => {
                                    e.preventDefault();
                                    if (recordingStatus === 'inactive') startRecording();
                                    else if (recordingStatus === 'recording') pauseRecording();
                                    else if (recordingStatus === 'pauseRecording') resumeRecording();
                                    else if (recordingStatus === 'recorded') restartRecording();
                                }}
                            >
                                {recordingStatus === 'inactive' ? (
                                    <span>
                                        <Icon name="caret-right-filled"></Icon> Start
                                    </span>
                                ) : recordingStatus === 'recording' ? (
                                    <span className={styles.audioRecorderIcon}>
                                        <Icon name="caret-right-filled"></Icon> Pause
                                    </span>
                                ) : recordingStatus === 'pauseRecording' ? (
                                    <span className={styles.audioRecorderIcon}>
                                        <Icon name="caret-right-filled"></Icon> Resume
                                    </span>
                                ) : (
                                    <span className={styles.audioRecorderIcon}>
                                        <Icon name="redo"></Icon> Restart
                                    </span>
                                )}
                            </Button>
                            {(recordingStatus === 'recording' || recordingStatus === 'pauseRecording') && (
                                <Button onClick={stopRecording}>
                                    <span className={styles.audioRecorderIcon}>
                                        <Icon name="close"></Icon> Stop
                                    </span>
                                </Button>
                            )}
                            {recordingStatus === 'recording' ? (
                                <div className={styles.audioRecorderStopWatch}>
                                    <span>
                                        {String(Math.floor(stopWatchTime / 360000)).padStart(2, '0')}:
                                        {String(Math.floor((stopWatchTime % 360000) / 6000)).padStart(2, '0')}:
                                        {String(Math.floor((stopWatchTime % 6000) / 100)).padStart(2, '0')}
                                    </span>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </Grid>
            </div>
            <div className={!audioUrl ? '' : styles.recordingItem} style={{ height: !audioUrl ? 0 : '' }}>
                {recordingStatus === 'recorded' ? (
                    <div className={styles.recordingItemHeader}>
                        <div>Recording {lastRecordingDetails?.index}</div>
                        <div>{lastRecordingDetails?.duration}</div>
                    </div>
                ) : null}
                <div
                    id="waveformForRecording"
                    style={{
                        marginTop: '5px',
                        height: !audioUrl ? 0 : '',
                        display: !audioUrl ? 'table' : 'block',
                    }}
                />
                <AudioControls
                    wavesurfer={wavesurfer}
                    audioLoading={audioLoading}
                    showControls={showControls}
                    setShowControls={setShowControls}
                    playingAudio={playingAudio}
                    setPlayingAudio={setPlayingAudio}
                    playBackSpeed={playBackSpeed}
                    setPlayBackSpeed={setPlayBackSpeed}
                    audioBlob={audioBlob}
                    isEmbeded={true}
                />
            </div>
        </div>
    );
}
