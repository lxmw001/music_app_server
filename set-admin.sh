#!/bin/bash

# Set admin custom claim on a Firebase user

PROJECT_ID="music-app-e8267"

echo "Enter the user email to make admin:"
read USER_EMAIL

# Get the user UID
USER_UID=$(gcloud firestore documents list users --project=$PROJECT_ID --format="value(name)" --filter="email=$USER_EMAIL" 2>/dev/null | head -1)

if [ -z "$USER_UID" ]; then
  echo "User not found. Please provide the Firebase UID directly:"
  read USER_UID
fi

echo "Setting admin claim for user: $USER_UID"

# Create a temporary Node.js script to set the custom claim
cat > /tmp/set-admin.js << 'EOF'
const admin = require('firebase-admin');

const serviceAccount = require(process.env.SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const uid = process.argv[2];

admin.auth().setCustomUserClaims(uid, { admin: true })
  .then(() => {
    console.log('Admin claim set successfully for user:', uid);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error setting admin claim:', error);
    process.exit(1);
  });
EOF

# Run the script
export SERVICE_ACCOUNT_PATH="$HOME/Downloads/music-app-e8267-firebase-adminsdk-fbsvc-1bd23877db.json"
node /tmp/set-admin.js "$USER_UID"

# Clean up
rm /tmp/set-admin.js

echo "Done! The user will need to re-authenticate to get the new token with admin claim."
