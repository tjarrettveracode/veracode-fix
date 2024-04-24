import fs from 'fs';
import { createFlawInfo } from './createFlawInfo';
import { checkCWE } from './check_cwe_support';
import tarModule from 'tar';
import { uploadBatch, checkFixBatch, pullBatchFixResults } from './requests'
import { execSync }  from 'child_process';
import * as github from '@actions/github'

export async function runBatch( options:any, credentials:any){

    //read json file
    const jsonRead = fs.readFileSync(options.file, 'utf8')
    const jsonData = JSON.parse(jsonRead);
    const jsonFindings = jsonData.findings
    const flawCount = jsonFindings.length
    console.log('Number of flaws: '+flawCount)

    //loop through json file and create a new array
    let i = 0
    let flawArray:any = {}
    for (i = 0; i < flawCount; i++) {

        //create a new array per source file
        let sourceFile = jsonFindings[i].files.source_file.file;

        if (!flawArray[sourceFile]) {
            flawArray[sourceFile] = [];
        }
        flawArray[sourceFile].push(jsonFindings[i]);
    }

    //loop through the new array per source file and find fixable flaws, supported CWE's and CWE's to be fixed
    let sourceFiles = Object.keys(flawArray);
    const sourceFilesCount = sourceFiles.length
    console.log('Number of source files with flaws: '+sourceFilesCount)
    for (let i = 0; i < sourceFilesCount; i++) {

        console.log('#############################\n\n')

        let sourceFile = sourceFiles[i];
        console.log('Source file with flaws:', sourceFile);

        let j = 0
        let flawCount = flawArray[sourceFile].length
        console.log('Number of flaws for '+sourceFile+': '+flawCount)

        for (j = 0; j < flawCount; j++) {

            const initialFlawInfo = {
                resultsFile: options.file,
                issuedID: flawArray[sourceFile][j].issue_id,
                cweID: parseInt(flawArray[sourceFile][j].cwe_id),
                language: options.language,
                sourceFile: sourceFile,
            }

            if (options.cwe != '') {

                console.log('Fix only for CWE: '+options.cwe)

                //get CWE list input
                let cweList = [];
                if (options.cwe.includes(',')) {
                    cweList = options.cwe.split(',');
                } else {
                    cweList = [options.cwe];
                }

                if (cweList.includes(flawArray[sourceFile][j].cwe_id)) {
                    console.log('CWE '+flawArray[sourceFile][j].cwe_id+' is in the list of CWEs to fix, creating flaw info')
                    
                    if (await checkCWE(initialFlawInfo, options) == true){
                        const flawInfo = await createFlawInfo(initialFlawInfo,options)
                        console.log('Flaw Info:',flawInfo)

                        //write flaw info and source file
                        const flawFoldername = 'cwe-'+flawInfo.CWEId+'-line-'+flawInfo.line+'-issue-'+flawInfo.issueId
                        const flawFilenane = 'flaw_'+flawInfo.issueId+'.json'
                        console.log('Writing flaw to: app/'+flawFoldername+'/'+flawFilenane)
                        fs.mkdirSync('app/flaws/'+flawFoldername, { recursive: true });
                        fs.writeFileSync('app/flaws/'+flawFoldername+'/'+flawFilenane, JSON.stringify(flawInfo, null, 2))

                        if (fs.existsSync('app/'+flawInfo.sourceFile)) {
                            console.log('File exists nothing to do');
                        } else {
                            console.log('File does not exist, copying file');
                            let str = flawInfo.sourceFile;
                            let lastSlashIndex = str.lastIndexOf('/');
                            let strBeforeLastSlash = str.substring(0, lastSlashIndex);
                            if (!fs.existsSync('app/'+strBeforeLastSlash)) {
                                console.log('Destination directory does not exist lest create it');
                                fs.mkdirSync('app/'+strBeforeLastSlash, { recursive: true });
                            }

                            fs.copyFileSync(flawInfo.sourceFile, 'app/'+flawInfo.sourceFile)
                        }
                    }
                    else {
                        console.log('CWE '+flawArray[sourceFile][j].cwe_id+' is not supported for '+options.language)
                    }
                }
                else {
                    console.log('CWE '+flawArray[sourceFile][j].cwe_id+' is not in the list of CWEs to fix')
                }
            }
            else {
                console.log('Fix for all CWEs')

                if (await checkCWE(initialFlawInfo, options) == true){
                    const flawInfo = await createFlawInfo(initialFlawInfo,options)
                    
                    //write flaw info and source file
                    const flawFoldername = 'cwe-'+flawInfo.CWEId+'-line-'+flawInfo.line+'-issue-'+flawInfo.issueId
                    const flawFilenane = 'flaw_'+flawInfo.issueId+'.json'
                    console.log('Writing flaw to: app/flaws/'+flawFoldername+'/'+flawFilenane)
                    fs.mkdirSync('app/flaws/'+flawFoldername, { recursive: true });
                    fs.writeFileSync('app/flaws/'+flawFoldername+'/'+flawFilenane, JSON.stringify(flawInfo, null, 2))

                    if (fs.existsSync('app/'+flawInfo.sourceFile)) {
                        console.log('File exists nothing to do');
                    } else {
                        console.log('File does not exist, copying file');
                        let str = flawInfo.sourceFile;
                        let lastSlashIndex = str.lastIndexOf('/');
                        let strBeforeLastSlash = str.substring(0, lastSlashIndex);
                        if (!fs.existsSync('app/'+strBeforeLastSlash)) {
                            console.log('Destination directory does not exist lest create it');
                            fs.mkdirSync('app/'+strBeforeLastSlash, { recursive: true });
                        }

                        fs.copyFileSync(flawInfo.sourceFile, 'app/'+flawInfo.sourceFile)
                    }

                }
                else {
                    console.log('CWE '+flawArray[sourceFile][j].cwe_id+' is not supported for '+options.language)
                }
            }
        }
    };

    //create the tar after all files are created and copied
    // the tr for the batch run has to be crearted with the local tar. The node moldule is not working
    const tarball = execSync('tar -czf app.tar.gz -C app .');
    console.log('Tar is created');

    const projectID = await uploadBatch(credentials, 'app.tar.gz', options)
    console.log('Project ID is: '+projectID)

    const checkBatchFixStatus = await checkFixBatch(credentials, projectID, options)

    if ( checkBatchFixStatus == 1 ){
        console.log('Batch Fixs are ready to be reviewed')
        const batchFixResults = await pullBatchFixResults(credentials, projectID, options)

        if ( batchFixResults == 0 ){
            console.log('Something went wrong, no fixes generated')
        }
        else {
            console.log('Fixs pulled from batch fix')
            console.log(batchFixResults)

            //working with results
            if (options.prComment == 'true'){
                console.log('PR commenting is enabled')
                //create PR comment
                //const batchFixResultsCount = batchFixResults.results.length
                const batchFixResultsCount = Object.keys(batchFixResults.results).length;

                console.log('Number of files with fixes: '+batchFixResultsCount)
                let commentBody:any
                for (let i = 0; i < batchFixResultsCount; i++) {
                    let keys = Object.keys(batchFixResults.results);
                    console.log('Creating PR comment for '+keys[i])
                    
                    commentBody = 'Fixes for '+keys[i]+':\n\n'
                    commentBody = commentBody +'Falws found for this file:\n\n'
                    const flawsCount = batchFixResults.results[keys[i]].flaws.length
                    for (let j = 0; j < flawsCount; j++) {
                        commentBody = commentBody +'CWE '+batchFixResults.results[keys[i]].flaws[j].CWEId+' in line '+batchFixResults.results[keys[i]].flaws[j].line+' for issue '+batchFixResults.results[keys[i]].flaws[j].issueId+'\n'
                    }
                    commentBody = commentBody + 'Fix:\n\n'
                    commentBody = commentBody + '```diff\n'
                    commentBody = commentBody + batchFixResults.results[keys[i]].patch[0]
                    commentBody = commentBody + '\n```'

                    console.log('PR Comment: '+commentBody)

                    console.log('check if we run on a pull request')
                    let pullRequest = process.env.GITHUB_REF

                    let isPR:any = pullRequest?.indexOf("pull")

                    if ( isPR >= 1 ){
                        console.log("This run is part of a PR, should add some PR comment")
                        const context = github.context
                        const repository:any = process.env.GITHUB_REPOSITORY
                        const token = options.token
                        const repo = repository.split("/");
                        const commentID:any = context.payload.pull_request?.number

                        try {
                            const octokit = github.getOctokit(token);
                
                            const { data: comment } = await octokit.rest.issues.createComment({
                                owner: repo[0],
                                repo: repo[1],
                                issue_number: commentID,
                                body: commentBody,
                            });
                            console.log('Adding scan results as comment to PR #'+commentID)
                        } catch (error:any) {
                            console.log(error);
                        }
                    }
                    else {
                        console.log('We are not running on a pull request')
                    }
                    
                }

            }
        }
    }
    else {
        console.log('Batch Fix failed')

    }

}