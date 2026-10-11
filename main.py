from contextlib import asynccontextmanager
from fastapi import FastAPI,staticfiles,HTTPException
from pydantic import BaseModel,Field
import pickle
from fastapi.staticfiles import StaticFiles
from tensorflow.keras.preprocessing.sequence import pad_sequences
from tensorflow.keras.preprocessing.text import Tokenizer
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from keras.models import load_model
import numpy as np



"""
1. We are going to make constants:
A. Model Path(BiGRU)
B. Tokenizer Path
C. Max Sequence length
D. Emotion label
E. Emotion Emojis
"""

model_path="Artifacts/BiGRU_Model.keras"

tokenizer_path ="Artifacts/tokenizer.pkl"

## Max Sequence length
max_sequence_length=50

##Emotion labels
emotion_labels = ['sadness', 'joy', 'love', 'anger', 'fear', 'surprise']

##Emotion Emojis
Emotion_EMOJIS = {
    'sadness': '😢',
    'joy': '😄',
    'love': '❤️',
    'anger': '😡',
    'fear': '😨',
    'surprise': '😲'
}

"""
2.Preprocess the Upcoming text
 Cleans raw text so it matches the format used while training 
 A.Convert text to lower case
 B.Remove Punctuations
 C.Remove Special Character
 D.Remove Extra spaces
"""

import re

def preprocess_text(text: str)->str:
  text = text.lower()
  text = re.sub(r"'","",text)
  text = re.sub(r"[^a-z0-9\s]"," ",text)
  text = re.sub(r"\s+"," ",text).strip()
  return text

"""
3.Request and Response Schemas
A. Text Input 
B. Prediction Response
C. Health Response
"""

class TextInput(BaseModel):
    text : str = Field(
       ...,
       min_length = 1,
       max_length = 2000,
       description = "The sentence to Analyse",
       json_schema_extra={"example": "I feel Very Happy"}
    )


class PredictionResponse(BaseModel):
   text : str
   predicted_emotion:str
   confidence:float
   all_probabilties:dict[str,float]


class HealthResponse(BaseModel):
   status: str
   Model_loaded: bool

"""
4.Model Loading and Lifespan Management
Load the model and tokenizer once the server starts up
"""
dl_model={}

@asynccontextmanager
async def lifespan(app:FastAPI):
   print('Loading the model and tokenizer...')
   dl_model["BiGRU"] = load_model(model_path)
   with open(tokenizer_path,'rb') as file:
     dl_model["Tokenizer"]=pickle.load(file)
   print('Model are loaded sucessfully.....')

   yield # pause,model is loaded and server is running and at this point model wait krta hai

   dl_model.clear()

"""
5.Mount the static files to the FastAPI app
A.Enable CORS to allow requests Form different origins
"""
app = FastAPI(
   lifespan=lifespan
)
app.add_middleware(
   CORSMiddleware,
   allow_origins=["*"],
   allow_credentials=True,
   allow_headers=["*"],
   allow_methods=["*"],
)

app.mount('/static',StaticFiles(directory="static"),name="static")
"""
6.API Endpoints.
A.Server UI at Homepage('/')
B.Health Check Endpoint ('/healthpoint')

"""

@app.get('/',include_in_schema=False)
def server_ui():
   return FileResponse('static/index.html')

@app.get('/health',response_model=HealthResponse)
def health_check():
   return HealthResponse(status="server is working",Model_loaded=bool(dl_model))

@app.post('/predict',response_model=PredictionResponse)
def Predict_emotion(text_input: TextInput):
   #1.Clean the input
    BiGRU_model = dl_model.get("BiGRU")
    tokenizer_model=dl_model.get("Tokenizer")

    if BiGRU_model is None or tokenizer_model is None:
       raise HTTPException(status_code=503,detail="model is not loaded try agian!!")

    cleaned_text = preprocess_text(text_input.text)

   #2.Convert the words into numeric using Tokenizer
    
    tokenized_text=tokenizer_model.texts_to_sequences([cleaned_text])
    
   #3.pad The Sequences to ensure unifrom length
    padded_sequence=pad_sequences(
       tokenized_text,
       maxlen=max_sequence_length,
       padding="post",
       truncating="post"
    )

    Probabilties = BiGRU_model.predict(padded_sequence)[0]

    top_emotion_index  = int(np.argmax(Probabilties))
    all_probabilites   = {
       label: float(prob) for prob, label in zip(Probabilties, emotion_labels)
      
    }

    return PredictionResponse(
       text = text_input.text,
       predicted_emotion= emotion_labels[top_emotion_index],
       confidence=float(Probabilties[top_emotion_index]),
       all_probabilties= all_probabilites
    )