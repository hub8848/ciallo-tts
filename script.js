let apiConfig;
let lastRequestTime = 0;
let currentAudioURL = null;

const API_CONFIG = {
    'workers-api': {
        url: 'https://worker-tts.api.zwei.de.eu.org/tts'
    },
    'deno-api': {
        url: 'https://deno-tts.api.zwei.de.eu.org/tts'
    }
};

function loadSpeakers() {
    return $.ajax({
        url: 'speakers.json',
        method: 'GET',
        dataType: 'json',
        success: function(data) {
            apiConfig = data;
            updateSpeakerOptions('workers-api');
        },
        error: function(jqXHR, textStatus, errorThrown) {
            console.error(`加载讲述者失败：${textStatus} - ${errorThrown}`);
            showError('加载讲述者失败，请刷新页面重试。');
        }
    });
}

function updateSpeakerOptions(apiName) {
    const speakers = apiConfig[apiName].speakers;
    const speakerSelect = $('#speaker');
    speakerSelect.empty();
    
    Object.entries(speakers).forEach(([key, value]) => {
        speakerSelect.append(new Option(value, key));
    });
}

function updateSliderLabel(sliderId, labelId) {
    const slider = $(`#${sliderId}`);
    const label = $(`#${labelId}`);
    label.text(slider.val());
    
    slider.off('input').on('input', function() {
        label.text(this.value);
    });
}

$(document).ready(function() {
    loadSpeakers().then(() => {
        $('#apiTips').text('使用 Workers API，每天限制 100000 次请求');

        $('[data-toggle="tooltip"]').tooltip();

        $('#api').on('change', function() {
            const apiName = $(this).val();
            updateSpeakerOptions(apiName);
            
            $('#rate, #pitch').val(0);
            updateSliderLabel('rate', 'rateValue');
            updateSliderLabel('pitch', 'pitchValue');
            
            const tips = {
                'workers-api': '使用 Workers API，每天限制 100000 次请求',
                'deno-api': '使用 Deno API，基于 Lobe-TTS，暂不支持语速语调调整'
            };
            $('#apiTips').text(tips[apiName] || '');
        });

        updateSliderLabel('rate', 'rateValue');
        updateSliderLabel('pitch', 'pitchValue');

        $('#generateButton').on('click', function() {
            if (canMakeRequest()) {
                generateVoice(false);
            } else {
                showError('请稍候再试，每3秒只能请求一次。');
            }
        });

        $('#previewButton').on('click', function() {
            if (canMakeRequest()) {
                generateVoice(true);
            } else {
                showError('请稍候再试，每3秒只能请求一次。');
            }
        });

        $('#text').on('input', function() {
            const currentLength = $(this).val().length;
            $('#charCount').text(`最多3000个字符，目前已输入${currentLength}个字符`);
        });
    });
});

function canMakeRequest() {
    const currentTime = Date.now();
    if (currentTime - lastRequestTime >= 3000) {
        lastRequestTime = currentTime;
        return true;
    }
    return false;
}

function generateVoice(isPreview) {
    const apiName = $('#api').val();
    const apiUrl = API_CONFIG[apiName].url;
    const text = $('#text').val().trim();
    
    if (!text) {
        showError('请输入要转换的文本');
        return;
    }

    if (isPreview) {
        const previewText = text.substring(0, 20);
        makeRequest(apiUrl, true, previewText, apiName === 'deno-api');
        return;
    }

    // 处理长文本
    const segments = splitText(text);
    if (segments.length > 1) {
        $('#loading').show();
        $('#error').hide();
        $('#result').hide();
        $('#generateButton').prop('disabled', true);
        $('#previewButton').prop('disabled', true);

        generateVoiceForLongText(segments).then(finalBlob => {
            if (finalBlob) {
                if (currentAudioURL) {
                    URL.revokeObjectURL(currentAudioURL);
                }
                currentAudioURL = URL.createObjectURL(finalBlob);
                $('#result').show();
                $('#audio').attr('src', currentAudioURL);
                $('#download').attr('href', currentAudioURL);

                const timestamp = new Date().toLocaleTimeString();
                const speaker = $('#speaker option:selected').text();
                const shortenedText = text.length > 5 ? text.substring(0, 5) + '...' : text;
                addHistoryItem(timestamp, speaker, shortenedText, finalBlob);
            }
        }).finally(() => {
            $('#loading').hide();
            $('#generateButton').prop('disabled', false);
            $('#previewButton').prop('disabled', false);
        });
    } else {
        makeRequest(apiUrl, false, text, apiName === 'deno-api');
    }
}

const cachedAudio = new Map();

function makeRequest(url, isPreview, text, isDenoApi) {
    try {
        new URL(url);
    } catch (e) {
        showError('无效的请求地址');
        return Promise.reject(e);
    }
    
    $('#loading').show();
    $('#error').hide();
    $('#result').hide();
    $('#generateButton').prop('disabled', true);
    $('#previewButton').prop('disabled', true);

    if (currentAudioURL) {
        URL.revokeObjectURL(currentAudioURL);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const requestBody = {
        text: text,
        voice: $('#speaker').val(),
        rate: parseInt($('#rate').val()),
        pitch: parseInt($('#pitch').val()),
        preview: isPreview
    };

    return fetch(url, { 
        method: 'POST',
        signal: controller.signal,
        headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    })
    .then(response => {
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`服务器响应错误: ${response.status}`);
        }
        if (!response.headers.get('content-type')?.includes('audio/')) {
            throw new Error('响应类型错误');
        }
        return response.blob();
    })
    .then(blob => {
        if (!blob.type.includes('audio/')) {
            throw new Error('返回的不是音频文件');
        }
        
        currentAudioURL = URL.createObjectURL(blob);
        $('#result').show();
        $('#audio').attr('src', currentAudioURL);
        $('#download').attr('href', currentAudioURL);

        if (!isPreview) {
            const timestamp = new Date().toLocaleTimeString();
            const speaker = $('#speaker option:selected').text();
            const shortenedText = text.length > 5 ? text.substring(0, 5) + '...' : text;
            addHistoryItem(timestamp, speaker, shortenedText, blob);
        }
    })
    .catch(error => {
        console.error('请求错误:', error);
        if (error.name === 'AbortError') {
            showError('请求超时，请重试');
        } else {
            showError(`生成失败：${isDenoApi ? 'Deno API 服务暂时不可用，请尝试使用 Workers API' : error.message}`);
        }
    })
    .finally(() => {
        $('#loading').hide();
        $('#generateButton').prop('disabled', false);
        $('#previewButton').prop('disabled', false);
    });
}

function showError(message) {
    showMessage(message, 'danger');
}

function addHistoryItem(timestamp, speaker, text, audioBlob) {
    const MAX_HISTORY = 50;
    const historyItems = $('#historyItems');
    
    if (historyItems.children().length >= MAX_HISTORY) {
        const oldestItem = historyItems.children().last();
        oldestItem.remove();
    }

    const audioURL = URL.createObjectURL(audioBlob);
    
    const historyItem = $(`
        <div class="history-item list-group-item" style="opacity: 0;">
            <div class="d-flex justify-content-between align-items-center">
                <span class="text-truncate" style="max-width: 60%;">${timestamp} -（${speaker}）- ${text}</span>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-primary play-btn" data-url="${audioURL}">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-success" onclick="downloadAudio('${audioURL}')">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            </div>
        </div>
    `);
    
    historyItem.on('remove', () => {
        URL.revokeObjectURL(audioURL);
    });
    
    historyItem.find('.play-btn').on('click', function() {
        playAudio($(this).data('url'));
    });
    
    $('#historyItems').prepend(historyItem);
    setTimeout(() => historyItem.animate({ opacity: 1 }, 300), 50);
}

function playAudio(audioURL) {
    const audioElement = $('#audio')[0];
    const allPlayButtons = $('.play-btn');
    
    // 如果点击的是当前正在播放的音频
    if (audioElement.src === audioURL && !audioElement.paused) {
        audioElement.pause();
        allPlayButtons.each(function() {
            if ($(this).data('url') === audioURL) {
                $(this).html('<i class="fas fa-play"></i>');
            }
        });
        return;
    }
    
    // 重置所有按钮图标
    allPlayButtons.html('<i class="fas fa-play"></i>');
    
    // 设置新的音频源并播放
    audioElement.onerror = function() {
        showError('音频播放失败，请重试');
    };
    audioElement.src = audioURL;
    audioElement.load();
    
    audioElement.play().then(() => {
        // 更新当前播放按钮图标
        allPlayButtons.each(function() {
            if ($(this).data('url') === audioURL) {
                $(this).html('<i class="fas fa-pause"></i>');
            }
        });
    }).catch(error => {
        console.error('播放失败:', error);
        showError('音频播放失败，请重试');
    });
    
    // 监听播放结束事件
    audioElement.onended = function() {
        allPlayButtons.each(function() {
            if ($(this).data('url') === audioURL) {
                $(this).html('<i class="fas fa-play"></i>');
            }
        });
    };
}

function downloadAudio(audioURL) {
    const link = document.createElement('a');
    link.href = audioURL;
    link.download = 'audio.mp3';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function clearHistory() {
    $('#historyItems .history-item').each(function() {
        $(this).remove();
    });
    
    $('#historyItems').empty();
    alert("历史记录已清除！");
}

function initializeAudioPlayer() {
    const audio = document.getElementById('audio');
    audio.style.borderRadius = '12px';
    audio.style.width = '100%';
    audio.style.marginTop = '20px';
}

function showMessage(message, type = 'error') {
    const errorDiv = $('#error');
    errorDiv.removeClass('alert-danger alert-warning alert-info')
           .addClass(`alert-${type}`)
           .text(message)
           .show();
    
    setTimeout(() => {
        errorDiv.fadeOut();
    }, 3000);
}

// 添加句子结束符号的正则表达式
const SENTENCE_ENDINGS = /[.。！？!?]/;
const PARAGRAPH_ENDINGS = /[\n\r]/;

function splitText(text, maxLength = 2000) {
    const segments = [];
    let remainingText = text;

    while (remainingText.length > 0) {
        if (remainingText.length <= maxLength) {
            segments.push(remainingText);
            break;
        }

        // 在2000字范围内寻找段落结束
        let splitIndex = -1;
        const searchEnd = Math.min(maxLength + 500, remainingText.length);
        
        // 1. 先找回车（自然段落）
        for (let i = maxLength; i >= maxLength - 500 && i >= 0; i--) {
            if (PARAGRAPH_ENDINGS.test(remainingText[i])) {
                splitIndex = i + 1;
                break;
            }
        }

        // 2. 如果没找到回车，找句号
        if (splitIndex === -1) {
            for (let i = maxLength; i >= maxLength - 500 && i >= 0; i--) {
                if (SENTENCE_ENDINGS.test(remainingText[i])) {
                    splitIndex = i + 1;
                    break;
                }
            }
        }

        // 3. 如果都没找到，强制分割
        if (splitIndex === -1) {
            splitIndex = maxLength;
        }

        segments.push(remainingText.substring(0, splitIndex));
        remainingText = remainingText.substring(splitIndex);
    }

    return segments;
}

async function generateVoiceForLongText(segments) {
    const results = [];
    const apiName = $('#api').val();
    const apiUrl = API_CONFIG[apiName].url;
    
    for (let i = 0; i < segments.length; i++) {
        $('#loading').text(`正在生成第 ${i + 1}/${segments.length} 段语音...`);
        
        try {
            const blob = await makeRequest(apiUrl, false, segments[i], apiName === 'deno-api');
            results.push(blob);
        } catch (error) {
            showError(`第 ${i + 1} 段生成失败：${error.message}`);
            return null;
        }
        
        // 添加延迟避免请求过快
        if (i < segments.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    return new Blob(results, { type: 'audio/mpeg' });
}