def runTestSuite(String target) {
    sh "docker buildx build --platform linux/amd64 --target ${target} --progress=plain --output type=local,dest=test-results/${target} ."
    junit testResults: "test-results/${target}/junit.xml"
    if (readFile("test-results/${target}/exit-code").trim() != '0') {
        error("${target} failed")
    }
}

pipeline {
    agent any

    environment {
        IMAGE_NAME = "ghcr.io/gripello/gripello"
        GHCR_CREDENTIALS_ID = "gripello-app"
        DOCKER_BUILDKIT = 1
        CI_ID = "${JOB_NAME}-${BUILD_NUMBER}".replaceAll(/[^a-zA-Z0-9]+/, '-').toLowerCase()
        DOCKER_CLI_EXPERIMENTAL = 'enabled'
        BUILDX_BUILDER = 'gripello'
        E2E_IMAGE = "gripello:e2e-${CI_ID}"
        E2E_COMPOSE = "docker compose -p e2e-${CI_ID} -f e2e/docker-compose.e2e.yml"
    }

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    stages {
        stage('Setup Buildx') {
            steps {
                script {
                    sh 'docker run --rm --privileged tonistiigi/binfmt --install all'
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
                    env.RELEASE_TAGS = tags
                }
            }
        }

        stage('Build & Unit Tests') {
            parallel {
                stage('Vitest') {
                    steps {
                        script { runTestSuite('vitest-results') }
                    }
                }
                stage('Go Hooks') {
                    steps {
                        script { runTestSuite('go-results') }
                    }
                }
                stage('Build (test image)') {
                    steps {
                        sh "docker buildx build --platform linux/amd64 --load --build-arg APP_VERSION=${env.APP_VERSION} -t ${env.E2E_IMAGE} ."
                    }
                }
                stage('E2E deps') {
                    steps {
                        sh '''
                            docker volume create gripello-e2e-yarn-cache
                            $E2E_COMPOSE run --rm --no-deps e2e sh -c "corepack enable && yarn install --immutable --mode=skip-build"
                        '''
                    }
                }
            }
        }

        stage('E2E Tests') {
            steps {
                sh '$E2E_COMPOSE up --attach e2e --abort-on-container-exit --exit-code-from e2e'
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

        stage('Build & Push (release image)') {
            steps {
                sh """
                    docker buildx build --platform linux/amd64 --provenance=true --sbom=true --build-arg APP_VERSION=${env.APP_VERSION} ${env.RELEASE_TAGS} --push .
                """
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
