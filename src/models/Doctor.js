import mongoose from "mongoose";
const schema = new mongoose.Schema({
  user:{type:mongoose.Schema.Types.ObjectId,ref:"User",unique:true,sparse:true},
  name:{type:String,required:true,trim:true},
  slug:{type:String,trim:true,lowercase:true,unique:true,sparse:true,index:true},
  specialty:String, qualification:String,
  experience:Number,address:String,city:String,location:String,fee:Number,image:String,
  gender:String,phone:String,bio:String,verified:{type:Boolean,default:false},
  hospital:String,chamberHospital:{type:mongoose.Schema.Types.ObjectId,ref:"Hospital"},hospitals:[{type:mongoose.Schema.Types.ObjectId,ref:"Hospital"}],
  scheduleDays:{type:[String],default:[]},scheduleStart:String,scheduleEnd:String,
  availability:String,signature:String,
  seo:{title:{type:String,default:""},description:{type:String,default:""},keywords:{type:String,default:""},ogTitle:{type:String,default:""},ogDescription:{type:String,default:""},ogImage:{type:String,default:""},canonical:{type:String,default:""},robots:{type:String,default:"index,follow"}}
},{timestamps:true});
schema.index({hospitals:1});
export default mongoose.model("Doctor",schema);
