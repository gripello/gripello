// Main writes the layer cache into a private GHCR package (one tag per target, parallel builds would overwrite one shared tag); every branch reads it.
def buildCache(String name) {
    def ref = "${env.CACHE_IMAGE}:${name}"
    def args = "--cache-from type=registry,ref=${ref}"
    if (env.BRANCH_NAME == 'main') {
        args += " --cache-to type=registry,ref=${ref},mode=max,image-manifest=true,oci-mediatypes=true,ignore-error=true"
    }
    args
}

def runTestSuite(String target, boolean junitReport = true, Map coverage = null) {
    sh "docker buildx build --platform linux/amd64 --target ${target} ${buildCache(target)} --progress=plain --output type=local,dest=test-results/${target} ."
    if (junitReport) {
        junit testResults: "test-results/${target}/junit.xml"
    }
    if (coverage && fileExists("test-results/${target}/${coverage.file}")) {
        recordCoverage id: coverage.id, name: coverage.name, sourceCodeRetention: 'NEVER',
            tools: [[parser: coverage.parser, pattern: "test-results/${target}/${coverage.file}"]]
    }
    if (readFile("test-results/${target}/exit-code").trim() != '0') {
        error("${target} failed")
    }
}

@NonCPS
def builtCommits(changeSets) {
    changeSets.collectMany { changeSet -> changeSet.items.collect { it.commitId } }
}

@NonCPS
def typeErrors(String log) {
    log.readLines().findAll { it.contains('error TS') }
}

def reportCheck(String name, String errorLog = null, Closure body) {
    publishChecks name: name, status: 'IN_PROGRESS'
    try {
        body()
        publishChecks name: name, conclusion: 'SUCCESS'
    } catch (err) {
        def errors = errorLog && fileExists(errorLog)
            ? typeErrors(readFile(errorLog))
            : []
        publishChecks name: name, conclusion: 'FAILURE',
            title: errors ? "${errors.size()} errors" : 'Failed',
            text: errors ? "```\n${errors.join('\n').take(60000)}\n```" : ''
        throw err
    }
}

pipeline {
    agent any

    environment {
        IMAGE_NAME = "ghcr.io/gripello/gripello"
        CACHE_IMAGE = "ghcr.io/gripello/gripello-cache"
        GHCR_CREDENTIALS_ID = "ghcr"
        DOCKER_BUILDKIT = 1
        CI_ID = "${JOB_NAME}-${BUILD_NUMBER}".replaceAll(/[^a-zA-Z0-9]+/, '-').toLowerCase()
        DOCKER_CLI_EXPERIMENTAL = 'enabled'
        BUILDX_BUILDER = 'gripello'
        E2E_IMAGE = "gripello:e2e-${CI_ID}"
        E2E_COMPOSE = "docker compose -p e2e-${CI_ID} -f e2e/docker-compose.e2e.yml"
        // alpha = closed testing; Play only accepts draft releases until the app is published, then switch to completed.
        PLAY_TRACK = 'alpha'
        PLAY_STATUS = 'draft'
    }

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    stages {
        stage('Setup') {
            steps {
                script {
                    sh 'docker buildx inspect gripello >/dev/null 2>&1 || docker buildx create --name gripello --driver docker-container || docker buildx inspect gripello'
                    sh 'docker buildx inspect --bootstrap'
                    withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'DOCKERHUB_USER', passwordVariable: 'DOCKERHUB_PASS')]) {
                        sh 'echo $DOCKERHUB_PASS | docker login -u $DOCKERHUB_USER --password-stdin'
                    }
                    withCredentials([usernamePassword(credentialsId: env.GHCR_CREDENTIALS_ID, usernameVariable: 'GHCR_USER', passwordVariable: 'GHCR_TOKEN')]) {
                        sh 'echo $GHCR_TOKEN | docker login ghcr.io -u $GHCR_USER --password-stdin'
                    }

                    // Resolve tags/version once, reused by the test-image build and the release build.
                    def branchName = env.BRANCH_NAME
                    def isReleaseCommit = false
                    def releaseVersion = ""

                    def commitMessage = sh(script: 'git log -1 --pretty=%B', returnStdout: true).trim().toLowerCase()
                    if (branchName == "main" && commitMessage ==~ /.*release\s+v?(\d+\.\d+\.\d+).*/) {
                        def matcher = (commitMessage =~ /release\s+v?(\d+\.\d+\.\d+)/)
                        if (matcher) {
                            releaseVersion = matcher[0][1]
                            isReleaseCommit = true
                        }
                    }

                    def tagName = ""
                    if (branchName == "main") {
                        tagName = "rolling"
                    } else if (branchName.startsWith("PR-")) {
                        tagName = "pr-${branchName.split('-')[1]}"
                    } else {
                        tagName = branchName.replaceAll(/[^a-zA-Z0-9._-]/, '-')
                    }

                    sh 'git fetch --tags --force --quiet || true'
                    def appVersion = sh(script: "git describe --tags --always | sed 's/^v//'", returnStdout: true).trim()
                    if (isReleaseCommit) {
                        appVersion = releaseVersion
                    }

                    def tags = "-t ${env.IMAGE_NAME}:${tagName}"
                    if (isReleaseCommit) {
                        tags += " -t ${env.IMAGE_NAME}:latest -t ${env.IMAGE_NAME}:${releaseVersion}"
                    }

                    env.APP_VERSION = appVersion
                    env.IS_RELEASE = isReleaseCommit.toString()

                    // A release commit that only bumps the version right after a green build of its parent ships already tested code.
                    def onlyVersionBump = sh(script: 'git diff --name-only HEAD~1 || true', returnStdout: true).trim() == 'package.json'
                    def head = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                    def parentPassed = currentBuild.previousBuild?.result == 'SUCCESS' && builtCommits(currentBuild.changeSets) == [head]
                    env.SKIP_TESTS = (isReleaseCommit && onlyVersionBump && parentPassed).toString()
                    env.RELEASE_TAGS = tags
                }
            }
        }

        stage('Build & Test') {
            parallel {
                stage('Vitest') {
                    when { expression { env.SKIP_TESTS != 'true' } }
                    steps {
                        script { runTestSuite('vitest-results', true, [id: 'coverage-vitest', name: 'Vitest Coverage', parser: 'COBERTURA', file: 'coverage/cobertura-coverage.xml']) }
                    }
                }
                stage('Typecheck') {
                    steps {
                        script {
                            reportCheck('Typecheck', 'test-results/typecheck-results/typecheck.txt') { runTestSuite('typecheck-results', false) }
                        }
                    }
                }
                stage('API Types') {
                    steps {
                        script {
                            reportCheck('API Types') { runTestSuite('api-types-results', false) }
                        }
                    }
                }
                stage('Go Tests') {
                    when { expression { env.SKIP_TESTS != 'true' } }
                    steps {
                        script { runTestSuite('go-results', true, [id: 'coverage-go', name: 'Go Coverage', parser: 'GO_COV', file: 'coverage.out']) }
                    }
                }
                stage('Build Image') {
                    when { expression { env.SKIP_TESTS != 'true' } }
                    steps {
                        script {
                            reportCheck('Build Image') {
                                sh "docker buildx build --platform linux/amd64 --load ${buildCache('app')} --build-arg APP_VERSION=${env.APP_VERSION} -t ${env.E2E_IMAGE} ."
                            }
                        }
                    }
                }
                stage('Android') {
                    steps {
                        script {
                            reportCheck('Android') {
                                try {
                                    runTestSuite('android-results', false)
                                } finally {
                                    junit testResults: 'test-results/android-results/junit/*.xml', allowEmptyResults: true
                                }
                            }
                            archiveArtifacts artifacts: 'test-results/android-results/gripello*', allowEmptyArchive: true
                        }
                    }
                }
                stage('E2E Install') {
                    when { expression { env.SKIP_TESTS != 'true' } }
                    steps {
                        // mcr.microsoft.com resets connections while pulling the Playwright image
                        retry(3) {
                            sh '''
                                docker volume create gripello-e2e-yarn-cache
                                $E2E_COMPOSE run --rm --no-deps e2e sh -c "corepack enable && yarn install --immutable --mode=skip-build"
                            '''
                        }
                    }
                }
            }
        }

        stage('E2E Tests') {
            when { expression { env.SKIP_TESTS != 'true' } }
            steps {
                sh 'E2E_DEPS_INSTALLED=1 $E2E_COMPOSE up --attach e2e --abort-on-container-exit --exit-code-from e2e'
            }
            post {
                failure {
                    sh '$E2E_COMPOSE logs --tail=500 app || true'
                }
                success {
                    script {
                        def flaky = fileExists('e2e/results/flaky.txt') ? readFile('e2e/results/flaky.txt').trim() : ''
                        if (flaky) {
                            publishChecks name: 'E2E flaky', title: "${flaky.readLines().size()} flaky e2e tests", summary: 'Passed only on retry', text: "```\n${flaky}\n```", conclusion: 'NEUTRAL'
                            unstable("Flaky e2e tests (passed only on retry):\n${flaky}")
                        }
                    }
                }
                always {
                    junit testResults: 'e2e/results/junit.xml', allowEmptyResults: true
                    archiveArtifacts artifacts: 'e2e/results/html/**, e2e/results/artifacts/**', allowEmptyArchive: true
                    sh '$E2E_COMPOSE down -v || true'
                }
            }
        }

        stage('Push Image') {
            steps {
                script {
                    reportCheck('Push Image') {
                        sh "docker buildx build --platform linux/amd64 --provenance=true --sbom=true ${buildCache('app')} --build-arg APP_VERSION=${env.APP_VERSION} ${env.RELEASE_TAGS} --push ."
                    }
                }
            }
        }

        stage('Play Store') {
            when { expression { env.IS_RELEASE == 'true' } }
            steps {
                script {
                    reportCheck('Play Store') {
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
                    }
                    archiveArtifacts artifacts: 'test-results/android-release/gripello-release.aab'
                    if (readFile('test-results/android-release/exit-code').trim() != '0') {
                        error('Play Store upload failed')
                    }
                }
            }
        }
    }


    post {
        always {
            script {
                sh 'docker buildx prune --builder gripello --keep-storage 20gb -f || true'
                sh '$E2E_COMPOSE down -v || true'
                sh "docker image rm ${env.E2E_IMAGE} || true"
            }
            cleanWs()
        }
    }
}
