require("dotenv").config()
import express from "express"
import http from "http"
var ffmpeg = require('ffmpeg')
const fluffmpeg = require('fluent-ffmpeg');
import speech from "@google-cloud/speech";
var fs = require('fs');
const path = require('path')
import { Storage } from "@google-cloud/storage";
import multer from "multer";

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, 'src/uploads/')
	},
	filename: (req,file, cb) => {
		cb(null, `${file.originalname.split('.')[0]}_${Date.now()}.${file.originalname.split('.').reverse()[0]}`)
	}
})
const upload = multer({ storage });

// const multer = Multer({
// 	storage: Multer.memoryStorage(),
// 	limits: {
// 			fileSize: 2 * 1024 * 1024, // no larger than 2mb, you can change as needed.
// 	},
// });

const includeArr = ["고열", "통증", "증상", "흡연", "식습관", "가족력"]

function mediaSeparator(path, file_name) {
	return new Promise((resolve,reject) => {
			var process = new ffmpeg(path);
			process.then(function (video) {
				// console.log(video)
				// Callback mode
				video.fnExtractSoundToMP3(`src/output/${file_name.split(".")[0]}.mp3`, function (error, file) {
					if (!error){
						console.log('Audio file: ' + file);
					} else {
						console.log(error)
					}
				resolve(`${file_name.split(".")[0]}.mp3`)
				});
		}, function (err) {
			console.log('Error: ' + err);
			reject(new Error(error))
		});
	})
}

//mp3 to flac
function mp3ToFlac(file_name) {
	return new Promise((resolve,reject) => {
		fluffmpeg(`src/output/${file_name}`).toFormat('flac').audioChannels(1).audioFrequency(16000)
		.on('error', (err) => {
				console.log('An error occurred: ' + err.message);
				return reject(new Error(err))
		})
		.on('progress', (progress) => {
				// console.log(JSON.stringify(progress));
				console.log('Processing: ' + progress.targetSize + ' KB converted');
		})
		.on('end', () => {
				console.log('Processing finished !');
				resolve(`src/output/${file_name.split(".")[0]}.flac`)
		})
		.save(`src/output/${file_name.split(".")[0]}.flac`);
	})
}

function uploadFileToGcp(file_path) {
	const gc = new Storage({
		keyFilename: path.join(__dirname, process.env.GCP_KEY_FILE),
		projectId: process.env.GCP_PROJECT_ID
	});
	
	// gc.getBuckets().then( x => console.log(x))
	const coolFilesBucket = gc.bucket(process.env.GCP_BUCKET_NAME)
	var audioFile = fs.createReadStream(`${file_path}`,{flags:'r'});

	const file_name = file_path.replace('src/output/',"")

	const writable = coolFilesBucket.file(file_name).createWriteStream({
		resumable: false,
		gzip:false
	})

	return new Promise((resolve, reject) => {
		audioFile.pipe(writable)
		writable.on('finish', () => {
			resolve(file_name)
		})
	})
}

async function speechToText(file_name, totalSec){
	return new Promise( async(resolve, reject) => {
		const client = new speech.SpeechClient();
		const gcsUri = `gs://${process.env.GCP_BUCKET_NAME}/${file_name}`;
		
		const encoding = "FLAC";
		const sampleRateHertz = 16000;
		const languageCode = 'ko-KR';

		const audio = {
			uri: gcsUri,
		};

		const config = {
			enableWordTimeOffsets: true,
			encoding: encoding,
			sampleRateHertz: sampleRateHertz,
			languageCode: languageCode,
		};

		const request = {
			config: config,
			audio: audio,
		};

		const [operation] = await client.longRunningRecognize(request);
		const [response] = await operation.promise();

		console.log(response)

		const resultArr = []


		try {

			response.results.forEach(result => {
				console.log(`Transcription: ${result.alternatives[0].transcript}`);
				result.alternatives[0].words.forEach(wordInfo => {
					includeArr.forEach(item => {
						const flag = wordInfo.word.includes(item)
						if(flag) {
							
							
							let lowSec = wordInfo.startTime.seconds-5;
							lowSec = (lowSec < 0) ? 0 : lowSec;

							let highSec = (+wordInfo.startTime.seconds)+15;
							
							highSec = (highSec > totalSec) ? totalSec : highSec;

							resultArr.push({ word: wordInfo.word, lowSec, highSec })
							
							const startSecs =`${wordInfo.startTime.seconds}`+'.'+wordInfo.startTime.nanos / 100000000;
							const endSecs =`${wordInfo.endTime.seconds}`+'.'+wordInfo.endTime.nanos / 100000000;
							console.log(`Word: ${wordInfo.word}`);
							console.log(`\t ${startSecs} secs - ${endSecs} secs`);
						}
					})
					// NOTE: If you have a time offset exceeding 2^32 seconds, use the
					// wordInfo.{x}Time.seconds.high to calculate seconds.
				});
			});	
			resolve(resultArr)
		}catch(e) {
			reject(new Error(error))
		}
	})
}

//같은 이름의 파일이 있을경우 안됨.
function highMediaDistributor(seq, file_name, startTime, endTime) {
	const savePath = `src/control/${file_name}_h`  //영상 파일
	
	return new Promise((resolve,reject) => {
		new ffmpeg( `src/uploads/${file_name}`,  (err, video)=>{  
				if (!err) {
						//#5. 시간 변경 하기 (비동기 방식)
						console.log("startTime: "+startTime)
						console.log("endTime: "+endTime)
						video
						.setVideoStartTime(startTime)  //시작시간
						.setVideoDuration(endTime-startTime)  //시간
						.save(`${savePath}/${seq}.mp4`, (error, file)=>{
							if(!error) {
								resolve()
							}
						})
				} else {
					reject(new Error(error))
				}
		})
	})
}

function lowMediaDistributor(seq, file_name, startTime, endTime) {
	const savePath = `src/control/${file_name}_l`  //영상 파일
	
	return new Promise((resolve,reject) => {
		new ffmpeg( `src/uploads/${file_name.split(".")[0]}_l.mp4`,  (err, video)=>{  
				if (!err) {
						//#5. 시간 변경 하기 (비동기 방식)
						console.log("startTime: "+startTime)
						console.log("endTime: "+endTime)
						video
						.setVideoStartTime(startTime)  //시작시간
						.setVideoDuration(endTime-startTime)  //시간
						.save(`${savePath}/${seq}.mp4`, (error, file)=>{
							if(!error) {
								resolve()
							}
						})
				} else {
					reject(new Error(error))
				}
		})
	})
}

function saveToLowQuality(file_name) {
	return new Promise((resolve,reject) => {
		fluffmpeg(`src/uploads/${file_name}`).videoBitrate('1')
		.on('end', () => {
			console.log('Processing finished !');
			resolve()
		})
		.save(`src/uploads/${file_name.split(".")[0]}_l.mp4`);
	})
	
}

function mergeVideos(sortedArr, file_name) {
	let highIdx = 0
	let lowIdx = 0
	const highPath = `src/control/${file_name}_h`  //영상 파일
	const lowPath = `src/control/${file_name}_l`  //영상 파일

	return new Promise((resolve,reject) => {
		let mergedVideo = fluffmpeg()

		for(let i =0; i<sortedArr.length; i++){
			if(sortedArr[i] === "low") {
				mergedVideo = mergedVideo.addInput(`${lowPath}/${lowIdx}.mp4`)
				lowIdx++;
			}else{
				mergedVideo = mergedVideo.addInput(`${highPath}/${highIdx}.mp4`)
				highIdx++;
			}
		}

		const outputFilePath = `src/result/${file_name.split(".")[0]}.mp4`;

		mergedVideo.mergeToFile(outputFilePath) //파일 1개로 만들기
		.on('error', function(err) {
				console.log('Error ::::  ' + err.message)
		})
		.on('end', function() {
				console.log('Finished!')
				resolve(outputFilePath)
		})
	})
}

const app = express()

app.set("view engine","pug")
app.set("views",__dirname+"/views")
app.use("/public",express.static(__dirname+"/public"))
app.get("/",(_,res)=>res.render("home"))
const handleListen = () => console.log(`Listening on http://localhost:4000`)
const httpServer = http.createServer(app)

httpServer.listen(4000,handleListen)
app.post("/video",upload.single('upload_video'), async(req,res) => {
	//filename : 업로드한 파일 명
	//path : 업로드한 파일 경로
	const {filename, path} = req.file

	if(!fs.existsSync(`src/control/${filename}_h`)) {
		fs.mkdirSync(`src/control/${filename}_h`)
	}
	if(!fs.existsSync(`src/control/${filename}_l`)) {
		fs.mkdirSync(`src/control/${filename}_l`)
	}
	
	//영상 총 시간 
	const totalSec = await new Promise( resolve => {
		ffmpeg(path, (err, video) => {
			if(!err) {
				resolve(video.metadata.duration.seconds);
			} else {
				console.log('Error: ' + err);
			}
		})
	})

	res.send({filename})
})
app.post("/upload",upload.single('upload_video'), async(req,res) => {
	//filename : 업로드한 파일 명
	//path : 업로드한 파일 경로
	const {filename, path} = req.file

	if(!fs.existsSync(`src/control/${filename}_h`)) {
		fs.mkdirSync(`src/control/${filename}_h`)
	}
	if(!fs.existsSync(`src/control/${filename}_l`)) {
		fs.mkdirSync(`src/control/${filename}_l`)
	}

	//영상 총 시간 
	const totalSec = await new Promise( resolve => {
		ffmpeg(path, (err, video) => {
			if(!err) {
				resolve(video.metadata.duration.seconds);
			} else {
				console.log('Error: ' + err);
			}
		})
	})

	//낮은 화질의 영상으로 변환
	await saveToLowQuality(filename)

	//영상 음성 분리
	const audioFileName = await mediaSeparator(path, filename)
	console.log(`audio file name :: ${audioFileName}`)

	//분리된 음성을 flac으로 변환 (mp3 to flac)
	const flacFileName = await mp3ToFlac(audioFileName)
	console.log(`flac file path :: ${flacFileName}`)

	//flac파일 gcp에 업로드 
	const uploadFileName = await uploadFileToGcp(flacFileName)
	console.log(`gcp upload file name :: ${uploadFileName}`)
	
	//stt 진행
	const timeArr = await speechToText(uploadFileName, totalSec)
	
	const highArr = []
	let lastHighSec = 0

	//고화질 구간 추출
	for(let i=0;i<timeArr.length;i++){
		let {lowSec, highSec} = timeArr[i]
		
		//구간이 겹친다는 의미
		if(lowSec < lastHighSec) {
			//마지막 요소 변경
			highArr[highArr.length-1].highSec = highSec
		}else {
			highArr.push({lowSec, highSec})
		}
		lastHighSec = highSec
	}

	//저화질 구간 추출
	let lowArr = []
	let	firstSec = 0
	let lastSec = 0
	for(let i=0;i<highArr.length;i++){
		lastSec = highArr[i].lowSec
		
		lowArr.push({lowSec:firstSec, highSec: lastSec})
		
		firstSec = highArr[i].highSec
	
	//마지막 요소가 비디오의 끝이 아니라면
	if(highArr.length - 1 === i && firstSec !== totalSec) {
			lowArr.push({lowSec:firstSec, highSec:totalSec})
		}
	}

	console.log(highArr, lowArr)

	for(let i = 0; i < highArr.length; i++) {
		await highMediaDistributor(i, filename, highArr[i].lowSec, highArr[i].highSec)
	}

	for(let i = 0; i < lowArr.length; i++) {
		await lowMediaDistributor(i, filename, lowArr[i].lowSec, lowArr[i].highSec)
	}

	const sortedArr = []
	let type = ["high","low"]
	for( let i =0; i< highArr.length; i++) {
		let flag = 0
		if(highArr[i].lowSec < lowArr[i].highSec) {
			sortedArr.push(type[flag])
		}else{
			flag = 1
			sortedArr.push(type[flag])
		}

		sortedArr.push(type[Number(!flag)])

		if(i===(highArr.length-1) && highArr.length < lowArr.length) {
			sortedArr.push(type[1])
		}
	}

	const resultFilePath = await mergeVideos(sortedArr, filename)

	
	var file = fs.readFileSync(resultFilePath, 'binary');

  res.setHeader('Content-Length', file.length);
	res.setHeader('Content-type', 'video/mp4');
  res.write(file, 'binary');
  res.end();
})