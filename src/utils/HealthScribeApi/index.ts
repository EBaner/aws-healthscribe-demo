// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import {
    DeleteMedicalScribeJobCommand,
    GetMedicalScribeJobCommand,
    ListMedicalScribeJobsCommand,
    StartMedicalScribeJobCommand,
    StartMedicalScribeJobRequest,
    TranscribeClient,
} from '@aws-sdk/client-transcribe';
import { list, remove } from 'aws-amplify/storage';

import { useS3 } from '@/hooks/useS3';
import { getConfigRegion, getCredentials, printTiming } from '@/utils/Sdk';

import { getS3Object } from '../S3Api';

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
    const accessPointArn = "arn:aws:s3:us-east-1:211125307481:accesspoint/fordelete";

    try {
        // Delete the MedicalScribe job
        const transcribeClient = new TranscribeClient({
            region: getConfigRegion(),
            credentials: await getCredentials(),
        });
        const deleteMedicalScribeJobCmd = new DeleteMedicalScribeJobCommand({
            MedicalScribeJobName: MedicalScribeJobName,
        });
        await transcribeClient.send(deleteMedicalScribeJobCmd);
        console.log(`Successfully deleted MedicalScribe job: ${MedicalScribeJobName}`);

        // Create S3 client with the specific access point
        const s3Client = new S3Client({
            region: "us-east-1", // Hardcoded to match the access point region
            credentials: await getCredentials(),
            endpoint: accessPointArn,
        });

        // Delete the S3 folder and its contents
        const folderKey = `uploads/HealthScribeDemo/${MedicalScribeJobName}/`;

        // List all objects in the folder
        const listParams = {
            Bucket: accessPointArn, // Use the access point ARN as the "bucket"
            Prefix: folderKey,
        };
        const listCommand = new ListObjectsV2Command(listParams);
        const listResult = await s3Client.send(listCommand);

        // Delete each object in the folder
        for (const item of listResult.Contents || []) {
            if (item.Key) {
                const deleteParams = {
                    Bucket: accessPointArn, // Use the access point ARN as the "bucket"
                    Key: item.Key,
                };
                const deleteCommand = new DeleteObjectCommand(deleteParams);
                await s3Client.send(deleteCommand);
                console.log(`Deleted object: ${item.Key}`);
            }
        }

        // Delete the folder itself (if necessary)
        const deleteFolderParams = {
            Bucket: accessPointArn, // Use the access point ARN as the "bucket"
            Key: folderKey,
        };
        const deleteFolderCommand = new DeleteObjectCommand(deleteFolderParams);
        await s3Client.send(deleteFolderCommand);
        console.log(`Successfully deleted S3 folder: ${folderKey}`);
    } catch (error) {
        console.error('Error in deleteHealthScribeJob:', error);
        throw error; // Re-throw the error for the caller to handle
    }

    const end = performance.now();
    printTiming(end - start, 'DeleteMedicalScribeJobCommand');
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
