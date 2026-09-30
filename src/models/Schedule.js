import mongoose from 'mongoose';
const schema=new mongoose.Schema({
 doctor:{type:mongoose.Schema.Types.ObjectId,ref:'Doctor',required:true},
 date:{type:String,required:true},serials:[{number:Number,available:Boolean}]
},{timestamps:true});
schema.index({doctor:1,date:1},{unique:true});
export default mongoose.model('Schedule',schema);
