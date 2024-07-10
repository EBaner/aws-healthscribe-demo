import React, { useEffect, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Popover from '@cloudscape-design/components/popover';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import TokenGroup from '@cloudscape-design/components/token-group';

import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Tag } from '@aws-sdk/client-s3/dist-types/models/models_0';
import { MedicalScribeParticipantRole, StartMedicalScribeJobRequest } from '@aws-sdk/client-transcribe';
import { VocabularyFilterMethod } from '@aws-sdk/client-transcribe';
import { Progress } from '@aws-sdk/lib-storage';
import { fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth';
import dayjs from 'dayjs';
import { Readable } from 'stream';

import { useS3 } from '@/hooks/useS3';
import { useAuthContext } from '@/store/auth';
import { useNotificationsContext } from '@/store/notifications';
import { startMedicalScribeJob } from '@/utils/HealthScribeApi';
import { multipartUpload } from '@/utils/S3Api';
import { getCredentials } from '@/utils/Sdk';
import sleep from '@/utils/sleep';

import amplifyCustom from '../../aws-custom.json';
import Auth from '../Auth';
import AudioRecorder from './AudioRecorder';
import { AudioDropzone } from './Dropzone';
import { AudioDetailSettings, AudioIdentificationType, InputName } from './FormComponents';
import styles from './NewConversation.module.css';
import { verifyJobParams } from './formUtils';
import { AudioDetails, AudioSelection } from './types';

async function getUserAttributes(username: string): Promise<string | null> {
    try {
        const { user } = useAuthContext();

        // Ensure user is authenticated
        if (!user) {
            console.error('User not authenticated.');
            return null;
        }

        // Fetch user attributes
        const attributes = await fetchUserAttributes();

        // Check if the 'custom:Clinic' attribute exists
        const clinicAttribute = attributes['custom:Clinic'];

        // Handle case where clinic attribute is missing
        if (!clinicAttribute) {
            console.warn('Clinic attribute not found for user.');
            return 'No Clinic Found';
        }

        // Return the clinic attribute value
        return clinicAttribute;
    } catch (error) {
        // Log and throw any errors that occur during attribute fetching
        console.error('Error fetching user attributes: ', error);
        throw error;
    }
}

async function streamToString(stream: Readable): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
}

async function getS3FileContent(bucketName: string, fileName: string): Promise<number> {
    const s3Client = new S3Client({
        region: 'us-east-1', // Hardcoded to match the access point region
        credentials: await getCredentials(),
    });

    try {
        const command = new GetObjectCommand({ Bucket: bucketName, Key: `ClinicCounter/${fileName}` });
        const response = await s3Client.send(command);
        const bodyContents = await streamToString(response.Body as Readable);
        return bodyContents ? parseInt(bodyContents, 10) : 0;
    } catch (error) {
        if (error instanceof NoSuchKey) {
            // File doesn't exist, create the file if needed
            await createS3FileIfNeeded(bucketName, fileName);
            return 0;
        }
        throw error; // Rethrow other errors
    }
}

async function createS3FileIfNeeded(bucketName: string, fileName: string): Promise<void> {
    const initialCount = 0; // Initial count value
    await putS3FileContent(bucketName, fileName, initialCount.toString());
}

async function putS3FileContent(bucketName: string, fileName: string, content: string): Promise<void> {
    const s3Client = new S3Client({
        region: 'us-east-1', // Hardcoded to match the access point region
        credentials: await getCredentials(),
    });

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: `ClinicCounter/${fileName}`,
        Body: content,
        ContentType: 'text/plain',
    });

    await s3Client.send(command);
}

export default function NewConversation() {
    const { updateProgressBar } = useNotificationsContext();
    const navigate = useNavigate();
    const { user } = useAuthContext();
    const loginId = user?.signInDetails?.loginId || 'No username found';
    const [clinicName, setClinicName] = useState<string>('No Clinic found');

    useEffect(() => {
        async function fetchClinicName() {
            const name = await getUserAttributes(loginId);
            if (typeof name === 'string') {
                setClinicName(name);
            } else {
                setClinicName('No Clinic found');
            }
        }
        fetchClinicName();
    }, [loginId]);

    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [formError, setFormError] = useState<string | React.ReactElement[]>('');
    const [jobName, setJobName] = useState<string>('');
    const [audioSelection, setAudioSelection] = useState<AudioSelection>('speakerPartitioning');
    const [audioDetails, setAudioDetails] = useState<AudioDetails>({
        speakerPartitioning: {
            maxSpeakers: 2,
        },
        channelIdentification: {
            channel1: 'CLINICIAN',
        },
    });
    const [filePath, setFilePath] = useState<File>();
    const [outputBucket, getUploadMetadata] = useS3();
    const [submissionMode, setSubmissionMode] = useState<string>('uploadRecording');
    const [recordedAudio, setRecordedAudio] = useState<File | undefined>();

    const fileToken = useMemo(() => {
        if (!filePath) {
            return undefined;
        } else {
            return {
                label: filePath.name,
                description: `Size: ${Number((filePath.size / 1000).toFixed(2)).toLocaleString()} kB`,
            };
        }
    }, [filePath]);

    function s3UploadCallback({ loaded, part, total }: Progress) {
        const value = Math.round(((loaded || 1) / (total || 100)) * 99);
        const loadedMb = Math.round((loaded || 1) / 1024 / 1024);
        const totalMb = Math.round((total || 1) / 1024 / 1024);
        updateProgressBar({
            id: `New HealthScribe Job: ${jobName}`,
            value: value,
            description: `Uploaded part ${part}, ${loadedMb}MB / ${totalMb}MB`,
        });
    }

    async function submitJob(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setIsSubmitting(true);
        setFormError('');

        try {
            const audioParams =
                audioSelection === 'speakerPartitioning'
                    ? {
                          Settings: {
                              MaxSpeakerLabels: audioDetails.speakerPartitioning.maxSpeakers,
                              ShowSpeakerLabels: true,
                          },
                      }
                    : {
                          ChannelDefinitions: [
                              {
                                  ChannelId: 0,
                                  ParticipantRole: audioDetails.channelIdentification
                                      .channel1 as MedicalScribeParticipantRole,
                              },
                              {
                                  ChannelId: 1,
                                  ParticipantRole:
                                      audioDetails.channelIdentification.channel1 === 'CLINICIAN'
                                          ? 'PATIENT'
                                          : ('CLINICIAN' as MedicalScribeParticipantRole),
                              },
                          ],
                          Settings: {
                              ChannelIdentification: true,
                              VocabularyName: 'CustomVetVocab',
                          },
                      };

            const uploadLocation = getUploadMetadata(jobName);
            const s3Location = {
                Bucket: uploadLocation.bucket,
                Key: `${uploadLocation.key}/${(filePath as File).name}`,
            };

            const userNameTag: Tag = {
                Key: 'UserName',
                Value: loginId,
            };

            const clinicTag: Tag = {
                Key: 'Clinic',
                Value: clinicName,
            };

            const jobParams: StartMedicalScribeJobRequest = {
                MedicalScribeJobName: jobName,
                DataAccessRoleArn: amplifyCustom.healthScribeServiceRole,
                OutputBucketName: outputBucket,
                Media: {
                    MediaFileUri: `s3://${s3Location.Bucket}/${s3Location.Key}`,
                },
                ...audioParams,
                Tags: [userNameTag, clinicTag],
            };

            const verifyParamResults = verifyJobParams(jobParams);
            if (!verifyParamResults.verified) {
                setFormError(verifyParamResults.message);
                setIsSubmitting(false);
                return;
            }

            window.scrollTo(0, 0);
            updateProgressBar({
                id: `New HealthScribe Job: ${jobName}`,
                value: 0,
                description: 'Upload to S3 in progress...',
            });

            try {
                await multipartUpload({
                    ...s3Location,
                    Body: filePath as File,
                    ContentType: filePath?.type,
                    callbackFn: s3UploadCallback,
                });
            } catch (e) {
                updateProgressBar({
                    id: `New HealthScribe Job: ${jobName}`,
                    type: 'error',
                    value: 0,
                    description: 'Uploading files to S3 failed',
                    additionalInfo: `Error uploading ${filePath!.name}: ${(e as Error).message}`,
                });
                setIsSubmitting(false);
                throw e;
            }

            const s3FileName = `${clinicTag.Value}.txt`;

            // Ensure the S3 file exists or is created
            await getS3FileContent(outputBucket, s3FileName);

            // Increment the count in the S3 file
            const currentCount = await getS3FileContent(outputBucket, s3FileName);
            const newCount = currentCount + 1;
            await putS3FileContent(outputBucket, s3FileName, newCount.toString());
            try {
                const startJob = await startMedicalScribeJob(jobParams);
                if (startJob?.MedicalScribeJob?.MedicalScribeJobStatus) {
                    updateProgressBar({
                        id: `New HealthScribe Job: ${jobName}`,
                        type: 'success',
                        value: 100,
                        description: 'HealthScribe job submitted',
                        additionalInfo: `Audio file successfully uploaded to S3 and submitted to HealthScribe at ${dayjs(
                            startJob.MedicalScribeJob.StartTime
                        ).format('MM/DD/YYYY hh:mm A')}. Redirecting to conversation list in 5 seconds.`,
                    });
                    await sleep(5000);
                    navigate('/conversations');
                } else {
                    updateProgressBar({
                        id: `New HealthScribe Job: ${jobName}`,
                        type: 'info',
                        value: 100,
                        description: 'Unable to confirm HealthScribe job submission',
                        additionalInfo: `Response from HealthScribe: ${JSON.stringify(startJob)}`,
                    });
                }
            } catch (e) {
                updateProgressBar({
                    id: `New HealthScribe Job: ${jobName}`,
                    type: 'error',
                    value: 0,
                    description: 'Submitting job to HealthScribe failed',
                    additionalInfo: (e as Error).message,
                });
            }
        } catch (error) {
            console.error('Error fetching user attributes:', error);
            setFormError('Error fetching user attributes. Please try again later.');
        } finally {
            setIsSubmitting(false);
        }
    }

    useEffect(() => {
        setFilePath(recordedAudio);
    }, [recordedAudio]);

    return (
        <ContentLayout
            header={
                <Header
                    description="Upload your audio file to be processed by AWS HealthScribe"
                    variant="awsui-h1-sticky"
                >
                    New Conversation
                </Header>
            }
        >
            <Container>
                <Box margin={{ bottom: 's' }} color="text-status-success" fontSize="heading-m">
                    Logged in as: {loginId}
                </Box>
                <form onSubmit={(e) => submitJob(e)}>
                    <Form
                        errorText={formError}
                        actions={
                            <SpaceBetween direction="horizontal" size="xs">
                                {isSubmitting ? (
                                    <Button formAction="submit" variant="primary" disabled={true}>
                                        <Spinner />
                                    </Button>
                                ) : (
                                    <Button formAction="submit" variant="primary" disabled={!filePath}>
                                        Submit
                                    </Button>
                                )}
                            </SpaceBetween>
                        }
                    >
                        <SpaceBetween direction="vertical" size="xl">
                            <InputName jobName={jobName} setJobName={setJobName} />
                            <AudioIdentificationType
                                audioSelection={audioSelection}
                                setAudioSelection={setAudioSelection}
                            />
                            <AudioDetailSettings
                                audioSelection={audioSelection}
                                audioDetails={audioDetails}
                                setAudioDetails={setAudioDetails}
                            />
                            <FormField
                                label={
                                    <SpaceBetween direction="horizontal" size="xs">
                                        <div>Session Recording Type</div>
                                        <Box
                                            display="inline-block"
                                            color="text-status-info"
                                            fontSize="body-s"
                                            fontWeight="bold"
                                        >
                                            <Popover
                                                header="Live Recording"
                                                content="Please position your device or microphone so it can capture all conversation participants."
                                            >
                                                <StatusIndicator type="info">Info</StatusIndicator>
                                            </Popover>
                                        </Box>
                                    </SpaceBetween>
                                }
                            >
                                <SpaceBetween direction="vertical" size="xl">
                                    <div className={styles.submissionModeRadio}>
                                        <RadioGroup
                                            ariaLabel="submissionMode"
                                            onChange={({ detail }) => setSubmissionMode(detail.value)}
                                            value={submissionMode}
                                            items={[
                                                { value: 'uploadRecording', label: 'Upload Recording' },
                                                { value: 'liveRecording', label: 'Live Recording' },
                                            ]}
                                        />
                                    </div>
                                    {submissionMode === 'liveRecording' ? (
                                        <>
                                            <FormField
                                                label="Live Recording"
                                                description="Note: You may only record one live recording at a time."
                                            ></FormField>
                                            <AudioRecorder setRecordedAudio={setRecordedAudio} />
                                        </>
                                    ) : (
                                        <FormField label="Select Files">
                                            <AudioDropzone setFilePath={setFilePath} setFormError={setFormError} />
                                            <TokenGroup
                                                i18nStrings={{
                                                    limitShowFewer: 'Show fewer files',
                                                    limitShowMore: 'Show more files',
                                                }}
                                                onDismiss={() => {
                                                    setFilePath(undefined);
                                                }}
                                                items={fileToken ? [fileToken] : []}
                                                alignment="vertical"
                                                limit={1}
                                            />
                                        </FormField>
                                    )}
                                </SpaceBetween>
                            </FormField>
                        </SpaceBetween>
                    </Form>
                </form>
            </Container>
        </ContentLayout>
    );
}
