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

export default function AudioRecorder({ setRecordedAudio }: AudioRecorderProps) {
    const wavesurfermic = useRef<WaveSurfer | undefined>(undefined);
    const wavesurferRecordPlugin = useRef<RecordPlugin | undefined>(undefined);
    const [recordingStatus, setRecordingStatus] = useState('inactive');
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [showControls, setShowControls] = useState<boolean>(false); // show/hide audio controls
    const [playingAudio, setPlayingAudio] = useState<boolean>(false); // is audio playing
    const [playBackSpeed, setPlayBackSpeed] = useState<number>(1); // playback speed
    const [audioLoading, setAudioLoading] = useState<boolean>(true); // is audio file loading
    const [stopWatchTime, setStopWatchTime] = useState(0);
    const [paused, setPaused] = useState(false); // is recording paused
    const [lastRecordingDetails, setLastRecordingDetails] = useState<Recording | null>(null);

    useEffect(() => {
        if (!wavesurfermic || !wavesurfermic.current) {
            wavesurfermic.current = WaveSurfer.create({
                container: '#wavesurfermic',
                waveColor: 'rgb(9, 114, 211)',
                progressColor: 'rgb(232, 232, 232)',
                height: 40,
            });
            wavesurferRecordPlugin.current = wavesurfermic.current?.registerPlugin(RecordPlugin.create());
        }
    }, []);

    useEffect(() => {
        let intervalId: NodeJS.Timeout | string | number | undefined;
        if (recordingStatus === 'recording' && !paused) {
            intervalId = setInterval(() => setStopWatchTime(stopWatchTime + 1), 10);
        } else if (recordingStatus === 'recorded' || paused) {
            clearInterval(intervalId as NodeJS.Timeout);
        }
        return () => clearInterval(intervalId as NodeJS.Timeout);
    }, [recordingStatus, stopWatchTime, paused]);

    const startRecording = () => {
        setRecordingStatus('recording');
        setPaused(false); // Reset pause status when starting recording
        wavesurferRecordPlugin.current?.startRecording();
        setShowControls(false);
    };

    const stopRecording = () => {
        setRecordingStatus('recorded');
        wavesurferRecordPlugin.current?.stopRecording();
        wavesurferRecordPlugin.current?.on('record-end', (blob) => {
            const audioUrl = URL.createObjectURL(blob);
            setRecordedAudio(new File([blob], 'recorded.mp3'));
            setAudioUrl(audioUrl);
            setAudioBlob(blob);
            loadWaveSurfer(audioUrl);
            setLastRecordingDetails({
                index: lastRecordingDetails === null ? 1 : lastRecordingDetails.index + 1,
                duration: formatStopWatchTime(),
            });
        });
    };

    const pauseRecording = () => {
        setPaused(true);
        wavesurferRecordPlugin.current?.pauseRecording();
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
        wavesurfermic.current?.load(audioUrl);
        wavesurfermic.current?.on('ready', () => {
            setAudioLoading(false);
            setShowControls(true);
        });

        wavesurfermic.current?.on('finish', () => {
            setPlayingAudio(!!wavesurfermic.current?.isPlaying());
        });
    };

    const formatStopWatchTime = () => {
        const hours = Math.floor(stopWatchTime / 360000);
        const minutes = Math.floor((stopWatchTime % 360000) / 6000);
        const seconds = Math.floor((stopWatchTime % 6000) / 100);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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
                            {recordingStatus === 'recording' ? 'Click "Stop" to stop the recording' : null}
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
                                    else if (recordingStatus === 'recording' && !paused) pauseRecording();
                                    else if (recordingStatus === 'pauseRecording') startRecording();
                                    else if (recordingStatus === 'recording') stopRecording();
                                    else if (recordingStatus === 'recorded') restartRecording();
                                }}
                            >
                                {recordingStatus === 'inactive' ? (
                                    <span>
                                        <Icon name="caret-right-filled"></Icon> Start
                                    </span>
                                ) : recordingStatus === 'recording' && !paused ? (
                                    <span className={styles.audioRecorderIcon}>
                                        <Icon name="caret-right-filled"></Icon> Pause
                                    </span>
                                ) : recordingStatus === 'recording' && paused ? (
                                    <span className={styles.audioRecorderIcon}>
                                        <Icon name="caret-right-filled"></Icon> Resume
                                    </span>
                                ) : (
                                    <span className={styles.audioRecorderIcon}>
                                        <Icon name="close"></Icon> Stop
                                    </span>
                                )}
                            </Button>
                            {recordingStatus === 'recording' && !paused ? (
                                <div className={styles.audioRecorderStopWatch}>
                                    <span>{formatStopWatchTime()}</span>
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
                    wavesurfer={wavesurfermic}
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
