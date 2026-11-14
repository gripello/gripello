@Library('pipeline-kit') _

// Main writes the app image's layer cache into a private GHCR package; every branch reads it (ci.test does the same per target).
def buildCache() {
    def ref = "${env.CACHE_IMAGE}:app"
    def args = "--cache-from type=registry,ref=${ref}"
    if (env.BRANCH_NAME == 'main') {
        args += " --cache-to type=registry,ref=${ref},mode=max,image-manifest=true,oci-mediatypes=true,ignore-error=true"
    }
    args
}

pipeline {
    agent { label 'k8s-m' }

    environment {
        IMAGE_NAME = "ghcr.io/gripello/gripello"
        CACHE_IMAGE = "ghcr.io/gripello/gripello-cache"
        PLAY_TRACK = 'production'
        PLAY_STATUS = 'completed'
    }

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    stages {
        stage('Setup') {
            steps {
                script {
                    ci.version()
                    // A release commit that only bumps the version right after a green build of its parent ships already tested code.
                    def onlyVersionBump = sh(script: 'git diff --name-only HEAD~1 || true', returnStdout: true).trim() == 'package.json'
                    def head = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                    def parentPassed = currentBuild.previousBuild?.result == 'SUCCESS' && ci.builtCommits() == [head]
                    env.SKIP_TESTS = (env.IS_RELEASE == 'true' && onlyVersionBump && parentPassed).toString()
                    env.RELEASE_TAGS = "-t ${env.IMAGE_NAME}:${env.CI_TAG}" + (env.IS_RELEASE == 'true' ? " -t ${env.IMAGE_NAME}:latest -t ${env.IMAGE_NAME}:${env.RELEASE_VERSION}" : '')
                    env.CI_IMAGE = "${env.IMAGE_NAME}:ci-${env.CI_TAG}"
                }
            }
        }

        stage('Build & Test') {
            steps {
                script {
                    def runTests = env.SKIP_TESTS != 'true'
                    def skip = 'Version bump after a green build'
                    ci.buildx {
                        ci.login('docker.io')
                        ci.login('ghcr.io')
                        parallel(
                            'Vitest': {
                                ci.check('Vitest', when: runTests, skip: skip) {
                                    ci.test('vitest-results', cache: env.CACHE_IMAGE, coverage: [id: 'coverage-vitest', name: 'Vitest Coverage', parser: 'COBERTURA', file: 'coverage/cobertura-coverage.xml'])
                                }
                            },
                            'Typecheck': {
                                ci.check('Typecheck', log: 'test-results/typecheck-results/typecheck.txt') {
                                    ci.test('typecheck-results', junit: false, cache: env.CACHE_IMAGE)
                                }
                            },
                            'API Types': {
                                ci.check('API Types') { ci.test('api-types-results', junit: false, cache: env.CACHE_IMAGE) }
                            },
                            'Go Tests': {
                                ci.check('Go Tests', when: runTests, skip: skip) {
                                    ci.test('go-results', cache: env.CACHE_IMAGE, coverage: [id: 'coverage-go', name: 'Go Coverage', parser: 'GO_COV', file: 'coverage.out'])
                                }
                            },
                            'Build Image': {
                                ci.check('Build Image', when: runTests, skip: skip) {
                                    // the e2e pod pulls the app from a registry; release tags only point at it once the tests passed
                                    sh "mkdir -p \"\$WORKSPACE_TMP\" && docker buildx build --platform linux/amd64 --provenance=true --sbom=true ${buildCache()} --build-arg APP_VERSION=${env.APP_VERSION} -t ${env.CI_IMAGE} --metadata-file \"\$WORKSPACE_TMP/app-image.json\" --push ."
                                    def digest = sh(script: '''sed -n 's/.*"containerimage.digest": "\\(sha256:[0-9a-f]*\\)".*/\\1/p' "$WORKSPACE_TMP/app-image.json"''', returnStdout: true).trim()
                                    if (!digest) {
                                        error('Build Image: no digest in the build metadata')
                                    }
                                    env.E2E_IMAGE_REF = "${env.IMAGE_NAME}@${digest}"
                                }
                            },
                            'Android': {
                                ci.check('Android') {
                                    try {
                                        ci.test('android-results', junit: 'junit/*.xml', allowEmptyResults: true, cache: env.CACHE_IMAGE)
                                    } finally {
                                        archiveArtifacts artifacts: 'test-results/android-results/gripello*', allowEmptyArchive: true
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }

        stage('E2E Tests') {
            steps {
                script {
                    ci.check('E2E Tests', when: env.SKIP_TESTS != 'true', skip: 'Version bump after a green build') {
                        def pod = readFile('.jenkins/e2e-pod.yaml').replace('APP_IMAGE', env.E2E_IMAGE_REF)
                        for (def service : ['postgres', 'mailpit', 'e2e']) {
                            pod = pod.replace("compose:${service}", sh(script: ".jenkins/compose-image.sh ${service}", returnStdout: true).trim())
                        }
                        podTemplate(inheritFrom: 'k8s-s', yamlMergeStrategy: override(), yaml: pod) {
                            // a pod lost before the tests ran (image pull, eviction) gets a fresh one
                            retry(count: 2, conditions: [kubernetesAgent(), nonresumable()]) {
                                node(POD_LABEL) {
                                    checkout scm
                                    try {
                                        container('playwright') {
                                            sh '''
                                                timeout 300 sh -c 'until [ -f /ssl/cert.pem ] && node -e "fetch(process.argv[1]).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" https://vg.test/api/health; do sleep 2; done'
                                                # the container step passes the agent's HOME and PATH, not the pod spec's
                                                export HOME=/tmp/home NPM_CONFIG_PREFIX=/tmp/npm PATH="/tmp/npm/bin:$PATH"
                                                mkdir -p "$HOME"
                                                npm install -g corepack@0.36.0 --force && corepack enable
                                                yarn install --immutable --mode=skip-build
                                                yarn test:e2e
                                            '''
                                        }
                                        def flaky = fileExists('e2e/results/flaky.txt') ? readFile('e2e/results/flaky.txt').trim() : ''
                                        if (flaky) {
                                            publishChecks name: 'E2E flaky', title: "${flaky.readLines().size()} flaky e2e tests", summary: 'Passed only on retry', text: "```\n${flaky}\n```", conclusion: 'NEUTRAL'
                                            // UNSTABLE reaches GitHub as a failed commit status; the neutral check is the signal
                                            echo "WARNING: Flaky e2e tests (passed only on retry):\n${flaky}"
                                        }
                                    } catch (err) {
                                        containerLog name: 'app', tailingLines: 500
                                        throw err
                                    } finally {
                                        junit testResults: 'e2e/results/junit.xml', allowEmptyResults: true
                                        archiveArtifacts artifacts: 'e2e/results/html/**, e2e/results/artifacts/**', allowEmptyArchive: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        stage('Push Image') {
            steps {
                script {
                    ci.buildx {
                        ci.login('ghcr.io')
                        ci.check('Push Image') {
                            if (env.E2E_IMAGE_REF) {
                                // ships the image the e2e tests ran against
                                sh "docker buildx imagetools create ${env.RELEASE_TAGS} ${env.E2E_IMAGE_REF}"
                            } else {
                                sh "docker buildx build --platform linux/amd64 --provenance=true --sbom=true ${buildCache()} --build-arg APP_VERSION=${env.APP_VERSION} ${env.RELEASE_TAGS} --push ."
                            }
                        }
                    }
                }
            }
        }

        stage('Play Store') {
            when { expression { env.IS_RELEASE == 'true' } }
            steps {
                script {
                    ci.buildx {
                        ci.check('Play Store') {
                            withCredentials([
                                file(credentialsId: 'android-upload-keystore', variable: 'ANDROID_KEYSTORE'),
                                string(credentialsId: 'android-keystore-password', variable: 'ANDROID_KEYSTORE_PASSWORD'),
                                string(credentialsId: 'android-key-password', variable: 'ANDROID_KEY_PASSWORD'),
                                file(credentialsId: 'android-google-services', variable: 'GOOGLE_SERVICES'),
                                file(credentialsId: 'play-service-account', variable: 'PLAY_SERVICE_ACCOUNT'),
                            ]) {
                                sh '''
                                    docker buildx build --platform linux/amd64 --target android-release-results --no-cache-filter android-release \
                                        --build-arg PLAY_TRACK=$PLAY_TRACK --build-arg PLAY_STATUS=$PLAY_STATUS \
                                        --secret id=android_keystore,src=$ANDROID_KEYSTORE \
                                        --secret id=android_keystore_password,env=ANDROID_KEYSTORE_PASSWORD \
                                        --secret id=android_key_password,env=ANDROID_KEY_PASSWORD \
                                        --secret id=google_services,src=$GOOGLE_SERVICES \
                                        --secret id=play_service_account,src=$PLAY_SERVICE_ACCOUNT \
                                        --progress=plain --output type=local,dest=test-results/android-release .
                                '''
                            }
                            archiveArtifacts artifacts: 'test-results/android-release/gripello-release.aab'
                            if (readFile('test-results/android-release/exit-code').trim() != '0') {
                                error('Play Store upload failed')
                            }
                        }
                    }
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
    }
}
