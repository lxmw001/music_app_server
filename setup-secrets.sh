#!/bin/bash

# Set up secrets in Google Cloud Secret Manager and configure Cloud Run

PROJECT_ID="music-app-e8267"
SERVICE_NAME="music-app-server"
REGION="us-central1"

echo "Setting up secrets in Google Cloud Secret Manager..."

# Read the Firebase service account file
SERVICE_ACCOUNT_FILE="$HOME/Downloads/music-app-e8267-firebase-adminsdk-fbsvc-1bd23877db.json"

# Extract values from service account JSON
FIREBASE_PROJECT_ID=$(jq -r '.project_id' "$SERVICE_ACCOUNT_FILE")
FIREBASE_CLIENT_EMAIL=$(jq -r '.client_email' "$SERVICE_ACCOUNT_FILE")
FIREBASE_PRIVATE_KEY=$(jq -r '.private_key' "$SERVICE_ACCOUNT_FILE")

echo "Enter your YouTube API Key:"
read YOUTUBE_API_KEY

echo "Enter your Gemini API Key:"
read GEMINI_API_KEY

# Create secrets (will fail if they already exist, that's ok)
echo "$FIREBASE_PRIVATE_KEY" | gcloud secrets create FIREBASE_PRIVATE_KEY --data-file=- --project=$PROJECT_ID 2>/dev/null || \
  echo "$FIREBASE_PRIVATE_KEY" | gcloud secrets versions add FIREBASE_PRIVATE_KEY --data-file=- --project=$PROJECT_ID

echo "$YOUTUBE_API_KEY" | gcloud secrets create YOUTUBE_API_KEY --data-file=- --project=$PROJECT_ID 2>/dev/null || \
  echo "$YOUTUBE_API_KEY" | gcloud secrets versions add YOUTUBE_API_KEY --data-file=- --project=$PROJECT_ID

echo "$GEMINI_API_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=- --project=$PROJECT_ID 2>/dev/null || \
  echo "$GEMINI_API_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=- --project=$PROJECT_ID

# Grant Cloud Run service account access to secrets
SERVICE_ACCOUNT="${PROJECT_ID}@appspot.gserviceaccount.com"

gcloud secrets add-iam-policy-binding FIREBASE_PRIVATE_KEY \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor" \
  --project=$PROJECT_ID

gcloud secrets add-iam-policy-binding YOUTUBE_API_KEY \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor" \
  --project=$PROJECT_ID

gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor" \
  --project=$PROJECT_ID

# Update Cloud Run service with environment variables and secrets
gcloud run services update $SERVICE_NAME \
  --region=$REGION \
  --project=$PROJECT_ID \
  --set-env-vars="FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID,FIREBASE_CLIENT_EMAIL=$FIREBASE_CLIENT_EMAIL,NODE_ENV=production" \
  --update-secrets="FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest,YOUTUBE_API_KEY=YOUTUBE_API_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest"

echo "Done! Secrets configured and Cloud Run service updated."
