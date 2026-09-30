import mongoose from "mongoose";
const schema = new mongoose.Schema({
  user:{type:mongoose.Schema.Types.ObjectId,ref:"User",unique:true,sparse:true},
  name:{type:String,required:true,trim:true},
  slug:{type:String,trim:true,lowercase:true,unique:true,sparse:true,index:true},
  email:{type:String,lowercase:true,trim:true}, phone:String, address:String, city:String, location:String,
  departments:[String], doctors:{type:Number,default:0}, image:String,
  verified:{type:Boolean,default:false}, emergency:{type:Boolean,default:false},
  seo:{title:{type:String,default:""},description:{type:String,default:""},keywords:{type:String,default:""},ogTitle:{type:String,default:""},ogDescription:{type:String,default:""},ogImage:{type:String,default:""},canonical:{type:String,default:""},robots:{type:String,default:"index,follow"}}
},{timestamps:true});
export default mongoose.model("Hospital",schema);
