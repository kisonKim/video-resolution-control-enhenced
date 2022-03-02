const videoElem = document.querySelector('#upload_video')
const overlayElem = document.querySelector('#overlay')

async function videoSubmit(event) {
  event.preventDefault();
  
  let flag = false;
  if(!videoElem.files[0]) {
    alert("파일을 선택해주세요.")
    flag = true;
  }
  
  if(!/\.(mp4)$/i.test(videoElem.files[0].name))  {
    alert(".mp4 파일만 선택해주세요.")
    flag = true;
  }

  if(videoElem.files[0].size > 100000000)  {
    alert("100MB 미만의 파일만 선택해주세요.")
    flag = true;
  }  

  if(flag) {
    return;
  }

  let send_data = new FormData();
  send_data.append('upload_video', videoElem.files[0]);

  overlayElem.classList.add('active')
  // await fetch("/video",{
  //   method: "POST",
  //   headers: {},
  //   body: send_data,
  // }).then(response => {
  //   console.log("비디오 전송 완료. videoName:");
  //   const filename = await response.json().result.filename;
  //   console.log(filename)
  // })
  await fetch("/upload", {
    method: "POST",
    headers: {},
    body: send_data,
  })
  .then(response => response.blob())
  .then(blob => {
    alert("완료!")
    let url = window.URL.createObjectURL(blob);
    let link = document.createElement('a');
    link.href = url;
    link.download = "videoResControl.mp4";
    link.click();
    link.remove();
  });
  overlayElem.classList.remove('active')
}