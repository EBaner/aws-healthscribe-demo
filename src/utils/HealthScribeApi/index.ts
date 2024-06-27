// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
    DeleteMedicalScribeJobCommand,
    GetMedicalScribeJobCommand,
    ListMedicalScribeJobsCommand,
    StartMedicalScribeJobCommand,
    StartMedicalScribeJobRequest,
    TranscribeClient,
} from '@aws-sdk/client-transcribe';
import { remove } from 'aws-amplify/storage';

import { useS3 } from '@/hooks/useS3';
import { getConfigRegion, getCredentials, printTiming } from '@/utils/Sdk';

async function getTranscribeClient() {
    return new TranscribeClient({
        region: getConfigRegion(),
        credentials: await getCredentials(),
    });
}

export type ListHealthScribeJobsProps = {
    JobNameContains?: string;
    MaxResults?: number;
    NextToken?: string;
    Status?: 'ALL' | 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
};
async function listHealthScribeJobs({
    JobNameContains,
    MaxResults = 100,
    NextToken,
    Status,
}: ListHealthScribeJobsProps) {
    const start = performance.now();
    const transcribeClient = await getTranscribeClient();
    const listMedicalScribeJobsInput = {
        ...(Status && Status !== 'ALL' && { Status: Status }),
        ...(JobNameContains && { JobNameContains: JobNameContains }),
        ...(NextToken && { NextToken: NextToken }),
        ...(MaxResults && { MaxResults: MaxResults }),
    };

    const listMedicalScribeJobsCmd = new ListMedicalScribeJobsCommand(listMedicalScribeJobsInput);
    const listMedicalScribeJobsRsp = await transcribeClient.send(listMedicalScribeJobsCmd);

    const end = performance.now();
    printTiming(end - start, 'ListMedicalScribeJobsCommand');

    return listMedicalScribeJobsRsp;
}

export type GetHealthScribeJobProps = {
    MedicalScribeJobName: string;
};
async function getHealthScribeJob({ MedicalScribeJobName }: GetHealthScribeJobProps) {
    const start = performance.now();
    const transcribeClient = await getTranscribeClient();
    const getMedicalScribeJobCmd = new GetMedicalScribeJobCommand({
        MedicalScribeJobName: MedicalScribeJobName,
    });
    const getMedicalScribeJobRsp = await transcribeClient.send(getMedicalScribeJobCmd);

    const end = performance.now();
    printTiming(end - start, 'GetMedicalScribeJobCommand');

    return getMedicalScribeJobRsp;
}

export type DeleteHealthScribeJobProps = {
    MedicalScribeJobName: string;
};

async function deleteHealthScribeJob({ MedicalScribeJobName }: DeleteHealthScribeJobProps) {
    const start = performance.now();

    // Delete the MedicalScribe job
    const transcribeClient = await getTranscribeClient();
    const deleteMedicalScribeJobCmd = new DeleteMedicalScribeJobCommand({
        MedicalScribeJobName: MedicalScribeJobName,
    });
    const deleteMedicalScribeJobRsp = await transcribeClient.send(deleteMedicalScribeJobCmd);

    // Delete the S3 object
    const s3Client = new S3Client({
        region: 'us-east-1', // Specified region
        credentials: await getCredentials(),
    });

    const bucketName = 'amplify-awshealthscribedemo-devb-ca5a3-deployment';
    const key = `studio-backend/storage/healthScribeDemoStorage/${MedicalScribeJobName}`;

    const deleteObjectCmd = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
    });

    try {
        await s3Client.send(deleteObjectCmd);
        console.log(`Successfully deleted S3 object: s3://${bucketName}/${key}`);
    } catch (error) {
        console.error(`Error deleting S3 object: s3://${bucketName}/${key}`, error);
    }

    // Attempt to remove using aws-amplify/storage as well
    try {
        await remove({
            key: `studio-backend/storage/healthScribeDemoStorage/${MedicalScribeJobName}`,
            options: {
                accessLevel: 'guest',
            },
        });
        console.log(`Successfully removed object using aws-amplify/storage: ${MedicalScribeJobName}`);
    } catch (error) {
        console.error(`Error removing object using aws-amplify/storage: ${MedicalScribeJobName}`, error);
    }

    const end = performance.now();
    printTiming(end - start, 'DeleteMedicalScribeJobCommand');

    return deleteMedicalScribeJobRsp;
}
async function startMedicalScribeJob(startMedicalScribeJobParams: StartMedicalScribeJobRequest) {
    const start = performance.now();
    const transcribeClient = await getTranscribeClient();
    const startMedicalScribeJobCmd = new StartMedicalScribeJobCommand(startMedicalScribeJobParams);
    const startMedicalScribeJobRsp = await transcribeClient.send(startMedicalScribeJobCmd);

    const end = performance.now();
    printTiming(end - start, 'StartMedicalScribeJobCommand');

    return startMedicalScribeJobRsp;
}

export { listHealthScribeJobs, getHealthScribeJob, deleteHealthScribeJob, startMedicalScribeJob };
