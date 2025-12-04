gcloud run deploy weather-client \
    --source . \
    --function weather-status \
    --region us-west1 \
    --base-image nodejs24 \
    --allow-unauthenticated \
    --execution-environment gen2