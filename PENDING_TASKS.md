# Pending Deployment Tasks

## GitHub Secrets Setup ✅ COMPLETED
~~Add these secrets in GitHub repository settings (Settings → Secrets and variables → Actions):~~

1. ~~**FIREBASE_SERVICE_ACCOUNT**~~ ✅
   - ~~Go to Firebase Console → Project Settings → Service Accounts~~
   - ~~Generate new private key~~
   - ~~Copy the entire JSON content~~

2. ~~**FIREBASE_PROJECT_ID**~~ ✅
   - ~~Your Firebase project ID (found in Firebase Console)~~

## Firebase Environment Variables
After first deployment, set these in Google Cloud Console:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select project: `music-app-e8267`
3. Navigate to: Cloud Run → music-app-server → Edit & Deploy New Revision
4. Under "Variables & Secrets" tab, add these environment variables:

```
FIREBASE_PROJECT_ID=music-app-e8267
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@music-app-e8267.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=<copy from service account JSON file>
YOUTUBE_API_KEY=<your-youtube-api-key>
GEMINI_API_KEY=<your-gemini-api-key>
PORT=8080
NODE_ENV=production
```

**Note**: For FIREBASE_PRIVATE_KEY, copy the entire private key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
