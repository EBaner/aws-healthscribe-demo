// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import uuid4 from 'uuid4';

import config from '@/amplifyconfiguration.json';

export function useS3() {
    const uploadKeyPrefix = 'uploads/HealthScribeDemo/';

    const bucketName = config.aws_user_files_s3_bucket;
    function getUploadMetadata(jobName: string) {
        return {
            bucket: bucketName,
            key: uploadKeyPrefix + jobName,
        };
    }

    return [bucketName, getUploadMetadata] as const;
}
